# Claude Collect Permissions

Orchestrate multiple Claude Code sessions and intelligently aggregate approved commands across projects.

## Features

- **Session Discovery**: List all active Claude Code sessions grouped by project and worktree
- **Command Aggregation**: Extract allowed/denied commands from project settings
- **Intelligent Grouping**: Use Claude Haiku to safely group similar commands with wildcards
- **Safety Validation**: Never wildcard dangerous commands (rm, --force, etc.)
- **User Settings Sync**: Apply approved commands to `~/.claude/settings.json`
- **History Tracking**: Maintain markdown log of all command approvals

## Installation

```bash
# Via npm
npm install -g claude-collect-permissions

# Via npx (no install)
npx claude-collect-permissions <command>

# Via bunx
bunx claude-collect-permissions <command>

# Via pnpm
pnpm dlx claude-collect-permissions <command>
```

## Usage

### List Active Sessions

```bash
claude-collect-permissions list
```

Shows all Claude Code sessions grouped by project, including:
- Project paths
- Git branches (worktrees)
- Number of sessions
- Last activity time

### 1. Collect & Analyze Commands

```bash
claude-collect-permissions collect
```

This will:
1. Discover all active sessions (last 7 days or since last run)
2. Extract commands from project `.claude/settings.json` and `settings.local.json`
3. Use Claude Haiku to intelligently group similar safe commands
4. Generate a review file (e.g., `review-2025-10-23-183045.json`)

### 2. Review Commands Interactively

```bash
claude-collect-permissions review review-2025-10-23-183045.json
```

Interactive controls:
- `A` - Approve current item
- `D` - Deny current item
- `S` - Skip (leave as pending)
- `N` - Next item
- `P` - Previous item
- `Q` - Save and quit

### 3. Apply Approved Commands

```bash
# Apply approved commands to ~/.claude/settings.json
claude-collect-permissions apply review-2025-10-23-183045.json
```

This will:
1. Read the review file
2. Extract approved patterns and commands
3. Backup `~/.claude/settings.json`
4. Merge approved commands into user settings
5. Append to `history/command-approvals.md`

## Safety Framework

The orchestrator uses a comprehensive safety framework to prevent dangerous wildcards:

### ✅ Safe to Wildcard
- Development commands: `poetry run:*`, `npm run:*`
- Non-destructive git: `git checkout:*`, `git add:*`
- Testing: `pytest:*`, `jest:*`
- Build tools: `npm build:*`, `cargo build:*`

### ⚠️ Maybe Safe (Review Required)
- Publishing: `git commit:*`, `git push:*` (without --force)
- Package installation: `npm install:*`, `pip install:*`

### ❌ Never Wildcard
- Destructive operations: `rm`, `del`, `--force`, `--hard`
- Permission changes: `chmod`, `chown`, `sudo`
- Network operations: `curl`, `wget`
- Domain access: `WebFetch(domain:*)` - keep specific
- Sensitive paths: `Read(//home/**)`, `Read(//etc/**)`

## Workflow

1. **Daily/Weekly**: Run `claude-collect-permissions collect` to gather commands from active sessions
2. **Review**: Edit the generated review file, approve/deny commands
3. **Apply**: Run `claude-collect-permissions apply review-*.json` to update user settings
4. **Benefit**: New Claude Code sessions automatically allow approved commands

## Examples

### Review File Format

```json
{
  "date": "2025-10-23T18:30:00.000Z",
  "groupings": [
    {
      "pattern": "Bash(poetry run:*)",
      "matches": ["Bash(poetry run test)", "Bash(poetry run lint)"],
      "reasoning": "Safe: All poetry run commands execute project-defined scripts",
      "confidence": "high",
      "safetyCategory": "SAFE_TO_WILDCARD",
      "approved": true  // ← Edit this
    }
  ],
  "ungrouped": [
    {
      "command": "Bash(rm -rf temp)",
      "reasoning": "Dangerous: Destructive file deletion",
      "safetyCategory": "NEVER_WILDCARD",
      "approved": false  // ← Edit this
    }
  ]
}
```

## Architecture

```
src/
├── cli.ts                 # Main CLI entry point
├── session-discovery.ts   # Parse ~/.claude/projects JSONL files
├── command-aggregator.ts  # Extract from project settings
├── grouping-agent.ts      # Use Haiku to group commands
├── settings-manager.ts    # Read/write ~/.claude/settings.json
├── history-tracker.ts     # Maintain approval history
└── types.ts              # TypeScript types
```

## Requirements

- Node.js 22+
- Claude Code CLI installed and authenticated
- Active Claude Code sessions with project settings

## License

MIT
