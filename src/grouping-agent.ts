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

  // Check 1b: WebFetch patterns can't use wildcards in domain names
  if (grouping.pattern.startsWith('WebFetch(domain:') && grouping.pattern.includes('*')) {
    return {
      valid: false,
      reason: `WebFetch doesn't support domain wildcards. Pattern "${grouping.pattern}" is invalid - domains must be explicit`
    };
  }

  // Check 2: For Bash commands, all matches must start with the same command base
  if (grouping.pattern.startsWith('Bash(') && grouping.pattern.includes(':*')) {
    const patternBase = grouping.pattern.split(':*')[0]; // e.g., "Bash(pnpm run"

    for (const match of grouping.matches) {
      // Each match must start with the exact pattern base
      if (!match.startsWith(patternBase)) {
        return {
          valid: false,
          reason: `Match "${match}" doesn't start with pattern base "${patternBase}"`
        };
      }
    }

    // Also check that we're not mixing different executables/subcommands
    const patternCmd = grouping.pattern.match(/Bash\(([^:)]+)/)?.[1]; // e.g., "pnpm run"
    const commands = new Set<string>();

    for (const match of grouping.matches) {
      const matchCmd = match.match(/Bash\(([^:)]+)/)?.[1];
      if (matchCmd) {
        commands.add(matchCmd);
      }
    }

    // All matches should have the same command as the pattern
    if (commands.size > 1 || (patternCmd && commands.size > 0 && !commands.has(patternCmd))) {
      return {
        valid: false,
        reason: `Pattern "${patternCmd}" but matches use different commands: ${Array.from(commands).join(', ')}`
      };
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

4. **WILDCARDING RULES** (from official Claude Code IAM docs):

   **Bash Commands**:
   - Wildcards ONLY work with :* suffix (must follow a colon)
   - The :* matches everything that starts with the prefix
   - Examples:
     - ✅ CORRECT: "Bash(npm run:*)" matches "npm run test", "npm run build", "npm run lint"
     - ✅ CORRECT: "Bash(poetry run:*)" matches "poetry run test", "poetry run lint"
     - ✅ CORRECT: "Bash(pnpm run:*)" matches all pnpm run commands
     - ❌ WRONG: "Bash(npm run *)" - wildcard must follow colon, not space
     - ❌ WRONG: "Bash(npm *)" - too broad, includes npm install, npm test, etc.
     - ❌ DANGEROUS: "Bash(rm:*)" - matches all rm commands including "rm -rf /"

   - ⚠️ CRITICAL: Each base command must be separate:
     - "Bash(pnpm run:*)" ≠ "Bash(pnpm test:*)" - different subcommands
     - "Bash(pnpm run:*)" ≠ "Bash(pnpm build:*)" - different subcommands
     - "Bash(bun:*)" ≠ "Bash(bunx:*)" - different executables
     - "Bash(npm:*)" ≠ "Bash(npx:*)" - different executables

   - Pattern matching rules:
     - Pattern "Bash(npm run:*)" can ONLY match commands starting with "npm run"
     - If you have "npm test", "npm build", "npm run test" - they need SEPARATE patterns:
       - "Bash(npm test:*)" for npm test commands
       - "Bash(npm build:*)" for npm build commands
       - "Bash(npm run:*)" for npm run commands

   **WebFetch**:
   - NO wildcards supported at all (per official docs)
   - Each domain must be listed separately
   - Examples:
     - ✅ CORRECT: "WebFetch(domain:github.com)" - single domain
     - ✅ CORRECT: "WebFetch(domain:stackoverflow.com)" - another separate entry
     - ❌ WRONG: "WebFetch(domain:*)" - wildcards not supported
     - ❌ WRONG: "WebFetch(domain:docs.*)" - wildcards not supported
     - ❌ WRONG: Any attempt to group multiple domains
   - Note: A single domain like "WebFetch(domain:github.com)" already includes subdomains

   **Read/Write/Edit**:
   - Use gitignore-style patterns
   - Be conservative with wildcards
   - Examples:
     - ✅ CORRECT: "Read(//Users/alex/work/**)" - specific path prefix
     - ❌ DANGEROUS: "Read(//**)" - entire filesystem

5. **GROUPING LOGIC**:

   **Can be grouped if**:
   - ALL commands have the EXACT same prefix before :*
   - Example: "Bash(npm run test)", "Bash(npm run build)", "Bash(npm run lint)" → "Bash(npm run:*)"
   - All variations are in SAFE category

   **MUST stay separate if**:
   - Different executables (npm vs npx vs pnpm)
   - Different subcommands (pnpm run vs pnpm test vs pnpm build)
   - Any command is destructive
   - WebFetch domains - NEVER group (no wildcard support)
   - Pattern would be too broad

6. **CRITICAL VALIDATION CHECKS**:
   - ❌ NEVER include the pattern itself in the matches array
   - ❌ NEVER group commands with different prefixes (before :*)
   - ❌ NEVER use wildcards in WebFetch
   - ✅ ALL matches must start with the same prefix as the pattern

OUTPUT FORMAT (strict JSON):
{
  "groupings": [
    {
      "pattern": "Bash(npm run:*)",
      "matches": ["Bash(npm run test)", "Bash(npm run build)", "Bash(npm run lint)"],
      "reasoning": "Safe: All npm run commands execute package.json scripts. Pattern 'npm run:*' correctly matches all commands starting with 'npm run'.",
      "confidence": "high",
      "safetyCategory": "SAFE_TO_WILDCARD"
    }
  ],
  "ungrouped": [
    {
      "command": "Bash(npm test)",
      "reasoning": "Cannot group with 'npm run' commands - different subcommand. Keep separate.",
      "shouldApprove": true,
      "safetyCategory": "SAFE_TO_WILDCARD"
    },
    {
      "command": "WebFetch(domain:docs.stripe.com)",
      "reasoning": "WebFetch does not support wildcards. Each domain must be separate.",
      "shouldApprove": true,
      "safetyCategory": "SAFE_TO_WILDCARD"
    },
    {
      "command": "Bash(rm -rf temp)",
      "reasoning": "Dangerous: Destructive file deletion. Never wildcard rm commands.",
      "shouldApprove": false,
      "safetyCategory": "NEVER_WILDCARD"
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

    const claude = spawn(claudePath, ['--model', 'sonnet', '--print'], {
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
  console.log('🤖 Analyzing commands with Claude Sonnet...');
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
  console.log('   Command: claude --model sonnet --print');
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
