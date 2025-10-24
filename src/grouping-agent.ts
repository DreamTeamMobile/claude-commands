#!/usr/bin/env tsx

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { CommandInfo, GroupingResult, Grouping } from './types.js';

const NEVER_WILDCARD_PATTERNS = [
  /rm\s+/,
  /del\s+/,
  /--force/,
  /--hard/,
  /chmod/,
  /chown/,
  /sudo/,
  /curl/,
  /wget/,
  /systemctl/,
  /kubectl.*delete/,
  /terraform.*destroy/,
];

/**
 * Validate that a grouping pattern is safe
 */
function validateGrouping(pattern: string): boolean {
  // Extract the actual command from pattern like "Bash(rm:*)"
  const commandMatch = pattern.match(/Bash\(([^:)]+)/);
  if (!commandMatch) return true;

  const command = commandMatch[1];

  // Check against never-wildcard list
  for (const dangerous of NEVER_WILDCARD_PATTERNS) {
    if (dangerous.test(command)) {
      console.warn(`⚠️  BLOCKED: Refusing to wildcard dangerous pattern: ${pattern}`);
      return false;
    }
  }

  return true;
}

/**
 * Validate that a grouping makes logical sense
 */
function validateGroupingLogic(grouping: Grouping): { valid: boolean; reason?: string } {
  // Check 1: Pattern shouldn't appear in its own matches
  if (grouping.matches.includes(grouping.pattern)) {
    return {
      valid: false,
      reason: `Pattern "${grouping.pattern}" appears in its own matches - redundant grouping`
    };
  }

  // Check 2: For Bash commands, ensure different executables aren't mixed
  if (grouping.pattern.startsWith('Bash(')) {
    const patternCmd = grouping.pattern.match(/Bash\(([^:)]+)/)?.[1];

    // Extract executable from each match
    const executables = new Set<string>();
    for (const match of grouping.matches) {
      const matchCmd = match.match(/Bash\(([^\s:)]+)/)?.[1];
      if (matchCmd) {
        executables.add(matchCmd);
      }
    }

    // If we have multiple different executables, that's wrong
    if (executables.size > 1) {
      return {
        valid: false,
        reason: `Mixed different executables: ${Array.from(executables).join(', ')} - these should be separate patterns`
      };
    }

    // Check if pattern executable matches the matches
    if (patternCmd && executables.size > 0 && !executables.has(patternCmd)) {
      return {
        valid: false,
        reason: `Pattern uses "${patternCmd}" but matches use ${Array.from(executables).join(', ')}`
      };
    }
  }

  // Check 3: All matches should have the same prefix as the pattern base
  if (grouping.pattern.includes(':*')) {
    const patternBase = grouping.pattern.split(':*')[0];

    for (const match of grouping.matches) {
      if (!match.startsWith(patternBase) && !match.includes(patternBase.replace('Bash(', ''))) {
        return {
          valid: false,
          reason: `Match "${match}" doesn't align with pattern "${grouping.pattern}"`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Generate the Haiku prompt for command grouping
 */
function generatePrompt(commands: CommandInfo[]): string {
  const commandsList = commands
    .map(c => `- ${c.command} (used in ${c.projects.length} project${c.projects.length > 1 ? 's' : ''})`)
    .join('\n');

  return `You are an expert at analyzing command patterns for safety and efficiency in developer workflows.

TASK: Analyze these Claude Code permission commands and suggest intelligent groupings.

COMMANDS:
${commandsList}

SAFETY FRAMEWORK:

1. **SAFE TO WILDCARD** (Confidence: HIGH):
   - Development tool commands: poetry run, npm run, pnpm, yarn
   - Version control (non-destructive): git checkout, git add, git status, git diff, git log
   - Testing frameworks: pytest, jest, vitest, cargo test
   - Build tools: npm build, cargo build, make
   - Linters/formatters: eslint, prettier, black, rustfmt
   - Package managers (read): pip list, npm list, cargo tree

   Pattern: Commands that are project-scoped, reversible, or read-only

2. **MAYBE SAFE** (Confidence: MEDIUM - suggest but flag for review):
   - Version control (publishing): git commit, git push (without --force)
   - Package installation: npm install, pip install, poetry add
   - Database migrations: forward migrations only

   Pattern: Commands that modify state but are generally safe in development

3. **NEVER WILDCARD** (Confidence: HIGH - keep individual):
   - Destructive file operations: rm, rmdir, del, unlink
   - Force operations: git push --force, git reset --hard
   - Permission changes: chmod, chown, sudo
   - Network operations: curl, wget (can download arbitrary code)
   - System modifications: systemctl, service, kill
   - Production deployments: kubectl apply, terraform apply, aws s3 rm
   - Domain access: WebFetch(domain:*) - keep specific domains
   - Sensitive paths: Read(//home/**), Read(//etc/**), paths with credentials

   Pattern: Irreversible, security-sensitive, or production-affecting commands

4. **WILDCARDING RULES**:
   - For Bash commands: Only wildcard the subcommand/arguments, not flags
     - ✅ GOOD: "Bash(poetry run:*)" matches "poetry run <any-command>"
     - ❌ BAD: "Bash(rm:*)" would match destructive operations
     - ⚠️ IMPORTANT: Different executables MUST stay separate:
       - "bun" and "bunx" are different commands - DON'T group together
       - "npm" and "npx" are different commands - DON'T group together
       - "pnpm" and "pnpx" are different commands - DON'T group together

   - For WebFetch: Keep domains explicit (but can group subdomains)
     - ✅ GOOD: "WebFetch(domain:github.com)" can include github.com, gist.github.com, raw.githubusercontent.com
     - ❌ BAD: "WebFetch(domain:*)" allows arbitrary domains

   - For Read: Be conservative with paths
     - ✅ GOOD: "Read(//Users/alex/work/**)" if pattern is consistent
     - ❌ BAD: "Read(//**)" allows reading entire filesystem

   - Pattern vs Matches:
     - ✅ GOOD: pattern "Bash(npm run:*)" matches ["Bash(npm run test)", "Bash(npm run build)"]
     - ❌ BAD: pattern "Bash(npm:*)" in matches list - the pattern should NOT appear in its own matches
     - ❌ BAD: pattern covers too much - "Bash(npm:*)" should be "Bash(npm run:*)" if only npm run commands

5. **GROUPING LOGIC**:
   - Commands are groupable if:
     a) They have the same base command (e.g., all "poetry run X")
     b) All variations are in the SAFE category
     c) The wildcard doesn't introduce new attack vectors

   - Commands should stay separate if:
     a) Any variation is destructive
     b) They involve different security contexts (domains, paths)
     c) The pattern is too broad to safely reason about

OUTPUT FORMAT (strict JSON):
{
  "groupings": [
    {
      "pattern": "Bash(poetry run:*)",
      "matches": ["Bash(poetry run test)", "Bash(poetry run analyze)"],
      "reasoning": "Safe: All poetry run commands execute project-defined scripts in pyproject.toml. Development-scoped and reversible.",
      "confidence": "high",
      "safetyCategory": "SAFE_TO_WILDCARD"
    }
  ],
  "ungrouped": [
    {
      "command": "Bash(rm -rf temp)",
      "reasoning": "Dangerous: Destructive file deletion. Never wildcard rm commands as 'rm -rf *' could delete critical files.",
      "shouldApprove": false,
      "safetyCategory": "NEVER_WILDCARD"
    },
    {
      "command": "Bash(git push origin main)",
      "reasoning": "Medium risk: Publishing changes. Safe to approve individually, but consider if you want to review each push.",
      "shouldApprove": true,
      "safetyCategory": "MAYBE_SAFE"
    }
  ],
  "statistics": {
    "totalCommands": ${commands.length},
    "grouped": 0,
    "ungrouped": 0,
    "categoryCounts": {
      "SAFE_TO_WILDCARD": 0,
      "MAYBE_SAFE": 0,
      "NEVER_WILDCARD": 0
    }
  }
}

Be conservative. When in doubt, don't group. User safety is paramount.
Only return valid JSON, no markdown formatting or code blocks.`;
}

/**
 * Call Claude CLI using spawn
 */
async function callClaudeCLI(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Get claude path from env or use default locations
    const claudePaths = [
      process.env.CLAUDE_CLI_PATH,
      join(homedir(), '.claude', 'local', 'claude'),
      'claude', // fallback to PATH
    ].filter(Boolean) as string[];

    let claudePath: string | null = null;
    for (const path of claudePaths) {
      if (existsSync(path)) {
        claudePath = path;
        break;
      }
    }

    if (!claudePath) {
      reject(new Error('Claude CLI not found. Please set CLAUDE_CLI_PATH in .env file or ensure claude is in PATH'));
      return;
    }

    const claude = spawn(claudePath, ['--model', 'haiku', '--print'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let lastDot = Date.now();

    claude.stdout.on('data', (data) => {
      stdout += data.toString();
      // Show progress dots every 500ms
      const now = Date.now();
      if (now - lastDot > 500) {
        process.stdout.write('.');
        lastDot = now;
      }
    });

    claude.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    claude.on('close', (code) => {
      process.stdout.write('\n'); // New line after progress dots
      if (code !== 0) {
        console.error(`\n❌ Claude CLI error (exit code ${code}):`);
        console.error(stderr);
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    claude.on('error', (error) => {
      reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
    });

    // Send prompt to stdin
    claude.stdin.write(prompt);
    claude.stdin.end();
  });
}

/**
 * Use Claude Haiku to intelligently group commands
 */
export async function groupCommands(commands: CommandInfo[]): Promise<GroupingResult> {
  const prompt = generatePrompt(commands);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🤖 Analyzing commands with Claude Haiku...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`📊 Total commands to analyze: ${commands.length}`);
  console.log(`📝 Prompt length: ${prompt.length} characters`);

  // Show first few commands as sample
  console.log(`\n📋 Sample commands (first 5):`);
  commands.slice(0, 5).forEach((cmd, i) => {
    console.log(`   ${i + 1}. ${cmd.command} (${cmd.projects.length} project${cmd.projects.length > 1 ? 's' : ''})`);
  });
  if (commands.length > 5) {
    console.log(`   ... and ${commands.length - 5} more\n`);
  }

  console.log('🔄 Calling Claude CLI...\n');
  console.log('   Command: claude --model haiku --print');
  console.log('   Waiting for response...\n');

  try {
    const response = await callClaudeCLI(prompt);

    console.log('✅ Received response from Claude');
    console.log(`📏 Response length: ${response.length} characters\n`);

    // Parse the JSON response
    let jsonText = response.trim();

    console.log('🔍 Parsing response...');

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      console.log('   Removing JSON markdown formatting...');
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
    } else if (jsonText.startsWith('```')) {
      console.log('   Removing markdown code blocks...');
      jsonText = jsonText.replace(/```\n?/g, '').replace(/```\n?$/g, '');
    }

    console.log('   Parsing JSON...');
    const result: GroupingResult = JSON.parse(jsonText);
    console.log('✅ Successfully parsed response\n');

    // Validate groupings
    console.log('🛡️  Validating groupings for safety and logic...');
    const originalGroupingCount = result.groupings.length;

    result.groupings = result.groupings.filter(g => {
      // Safety check
      if (!validateGrouping(g.pattern)) {
        console.log(`   ⚠️  Blocked dangerous pattern: ${g.pattern}`);
        // Move to ungrouped
        result.ungrouped.push(...g.matches.map(cmd => ({
          command: cmd,
          reasoning: `Blocked by safety validation: pattern "${g.pattern}" contains dangerous commands`,
          shouldApprove: false,
          safetyCategory: 'NEVER_WILDCARD' as const,
          approved: null,
        })));
        return false;
      }

      // Logic check
      const logicCheck = validateGroupingLogic(g);
      if (!logicCheck.valid) {
        console.log(`   ⚠️  Rejected bad grouping: ${g.pattern}`);
        console.log(`      Reason: ${logicCheck.reason}`);
        // Move to ungrouped
        result.ungrouped.push(...g.matches.map(cmd => ({
          command: cmd,
          reasoning: `Rejected grouping: ${logicCheck.reason}`,
          shouldApprove: true,
          safetyCategory: 'SAFE_TO_WILDCARD' as const,
          approved: null,
        })));
        return false;
      }

      return true;
    });

    const blockedCount = originalGroupingCount - result.groupings.length;
    if (blockedCount > 0) {
      console.log(`   🚫 Blocked/rejected ${blockedCount} bad grouping${blockedCount > 1 ? 's' : ''}`);
    } else {
      console.log('   ✅ All groupings passed validation');
    }

    // Add approved: null to all items
    result.groupings = result.groupings.map(g => ({ ...g, approved: null }));
    result.ungrouped = result.ungrouped.map(u => ({ ...u, approved: null }));

    console.log('\n📊 Analysis Results:');
    console.log(`   Grouped patterns: ${result.groupings.length}`);
    console.log(`   Ungrouped commands: ${result.ungrouped.length}`);
    console.log(`   Total analyzed: ${result.statistics.totalCommands}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return result;
  } catch (error) {
    console.error('Error calling Claude Haiku:', error);
    throw error;
  }
}
