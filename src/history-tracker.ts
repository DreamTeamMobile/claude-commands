#!/usr/bin/env tsx

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import type { ReviewFile } from './types.js';

/**
 * Append approval history to markdown file
 */
export async function appendToHistory(
  historyFile: string,
  reviewFile: ReviewFile,
  addedPatterns: string[],
  addedCommands: string[]
): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS

  let historyContent = '';

  // Read existing history if it exists
  if (existsSync(historyFile)) {
    historyContent = await readFile(historyFile, 'utf-8');
  } else {
    // Create directory if it doesn't exist
    const dir = dirname(historyFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Add header for new file
    historyContent = '# Claude Orchestrator - Command Approval History\n\n';
  }

  // Build new entry
  let newEntry = `## ${dateStr} ${timeStr}\n\n`;

  // Approved groupings
  if (addedPatterns.length > 0) {
    newEntry += '### Approved Groupings\n\n';
    for (const pattern of addedPatterns) {
      const grouping = reviewFile.groupings.find(g => g.pattern === pattern);
      if (grouping) {
        newEntry += `- \`${pattern}\` - ${grouping.reasoning}\n`;
        newEntry += `  - Replaced: ${grouping.matches.map(m => `\`${m}\``).join(', ')}\n`;

        // Count unique projects
        const projectsSet = new Set<string>();
        for (const match of grouping.matches) {
          const cmdInfo = reviewFile.groupings.find(g => g.matches.includes(match));
          // We don't have project info in groupings, skip for now
        }
        newEntry += '\n';
      }
    }
  }

  // Approved individual commands
  if (addedCommands.length > 0) {
    newEntry += '### Approved Individual Commands\n\n';
    for (const command of addedCommands) {
      const ungrouped = reviewFile.ungrouped.find(u => u.command === command);
      if (ungrouped) {
        newEntry += `- \`${command}\` - ${ungrouped.reasoning}\n`;
      }
    }
    newEntry += '\n';
  }

  // Statistics
  const totalApproved = addedPatterns.length + addedCommands.length;
  const totalDenied =
    reviewFile.groupings.filter(g => g.approved === false).length +
    reviewFile.ungrouped.filter(u => u.approved === false).length;
  const totalSkipped =
    reviewFile.groupings.filter(g => g.approved === null).length +
    reviewFile.ungrouped.filter(u => u.approved === null).length;

  newEntry += '### Statistics\n\n';
  newEntry += `- Total commands reviewed: ${reviewFile.statistics.totalCommands}\n`;
  newEntry += `- Grouped patterns: ${reviewFile.groupings.length}\n`;
  newEntry += `- Individual commands: ${reviewFile.ungrouped.length}\n`;
  newEntry += `- Approved (patterns): ${addedPatterns.length}\n`;
  newEntry += `- Approved (individual): ${addedCommands.length}\n`;
  newEntry += `- Denied/rejected: ${totalDenied}\n`;
  newEntry += `- Skipped/not reviewed: ${totalSkipped}\n`;
  newEntry += `- Projects analyzed: ${reviewFile.statistics.totalProjects}\n`;
  newEntry += '\n---\n\n';

  // Append to file
  historyContent += newEntry;

  await writeFile(historyFile, historyContent, 'utf-8');
  console.log(`✓ Updated history: ${historyFile}`);
}
