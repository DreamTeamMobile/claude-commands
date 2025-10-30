#!/usr/bin/env tsx

import { readFile, writeFile } from 'fs/promises';
import { stdin, stdout } from 'process';
import type { ReviewFile, Grouping, UngroupedCommand } from './types.js';

interface ReviewItem {
  type: 'grouping' | 'ungrouped';
  index: number;
  data: Grouping | UngroupedCommand;
}

/**
 * Clear the terminal
 */
function clearScreen() {
  stdout.write('\x1Bc');
}

/**
 * Move cursor to position
 */
function moveCursor(row: number, col: number) {
  stdout.write(`\x1B[${row};${col}H`);
}

/**
 * Display a grouping for review
 */
function displayGrouping(item: ReviewItem, current: number, total: number) {
  clearScreen();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📋 Review Commands (${current + 1}/${total})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (item.type === 'grouping') {
    const grouping = item.data as Grouping;
    const isMCPGrouping = grouping.groupType === 'mcp-server';

    if (isMCPGrouping) {
      // Special display for MCP server groupings
      const serverName = grouping.pattern.replace('mcp__', '');

      console.log(`🔌 MCP Server Grouping`);
      console.log(`🔹 Type: ${grouping.safetyCategory === 'MCP_SERVER' ? '✅ MCP Server' : grouping.safetyCategory}`);
      console.log(`🔹 Server: ${serverName}`);
      console.log(`🔹 Confidence: ${grouping.confidence}\n`);

      console.log(`📝 Reasoning:`);
      console.log(`   ${grouping.reasoning}\n`);

      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📦 Option 1: Approve Entire Server`);
      console.log(`   Pattern: ${grouping.pattern}`);
      console.log(`   Effect: Allows ALL commands from ${serverName} server\n`);

      console.log(`📦 Option 2: Approve Individual Commands (${grouping.matches.length} commands)`);
      grouping.matches.forEach((match, i) => {
        console.log(`   ${i + 1}. ${match}`);
      });
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      // Show current choice
      if (grouping.mcpChoice === 'server') {
        console.log(`📊 Current choice: ✅ ENTIRE SERVER (${grouping.pattern})`);
      } else if (grouping.mcpChoice === 'individual') {
        console.log(`📊 Current choice: ✅ INDIVIDUAL COMMANDS (${grouping.matches.length} commands)`);
      } else if (grouping.approved === false) {
        console.log(`📊 Current status: ❌ DENIED`);
      } else {
        console.log(`📊 Current status: ⏸️  PENDING`);
      }
    } else {
      // Standard display for non-MCP groupings
      console.log(`🔹 Type: ${grouping.safetyCategory === 'SAFE_TO_WILDCARD' ? '✅ Safe Pattern' : grouping.safetyCategory === 'MAYBE_SAFE' ? '⚠️  Maybe Safe' : '❌ Dangerous'}`);
      console.log(`🔹 Confidence: ${grouping.confidence}`);
      console.log(`\n📦 Pattern: ${grouping.pattern}\n`);

      console.log(`📝 Reasoning:`);
      console.log(`   ${grouping.reasoning}\n`);

      console.log(`🎯 Matches (${grouping.matches.length} commands):`);
      grouping.matches.forEach((match, i) => {
        console.log(`   ${i + 1}. ${match}`);
      });

      console.log(`\n📊 Current status: ${grouping.approved === true ? '✅ APPROVED' : grouping.approved === false ? '❌ DENIED' : '⏸️  PENDING'}`);
    }
  } else {
    const ungrouped = item.data as UngroupedCommand;

    console.log(`🔹 Type: ${ungrouped.safetyCategory === 'SAFE_TO_WILDCARD' ? '✅ Safe' : ungrouped.safetyCategory === 'MAYBE_SAFE' ? '⚠️  Maybe Safe' : ungrouped.safetyCategory === 'MCP_SERVER' ? '🔌 MCP' : '❌ Dangerous'}`);
    console.log(`🔹 Recommended: ${ungrouped.shouldApprove ? '✅ Yes' : '❌ No'}`);
    console.log(`\n📦 Command: ${ungrouped.command}\n`);

    console.log(`📝 Reasoning:`);
    console.log(`   ${ungrouped.reasoning}\n`);

    console.log(`📊 Current status: ${ungrouped.approved === true ? '✅ APPROVED' : ungrouped.approved === false ? '❌ DENIED' : '⏸️  PENDING'}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⌨️  Controls:');

  // Check if current item is MCP grouping to show special controls
  if (item.type === 'grouping' && (item.data as Grouping).groupType === 'mcp-server') {
    console.log('   [1] Approve Server   [2] Approve Individual   [D] Deny   [S] Skip');
  } else {
    console.log('   [A] Approve   [D] Deny   [S] Skip');
  }
  console.log('   [N] Next   [P] Previous   [Q] Save & Quit');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

/**
 * Interactive review of commands
 */
export async function interactiveReview(reviewFilePath: string): Promise<void> {
  // Read review file
  const content = await readFile(reviewFilePath, 'utf-8');
  const reviewFile: ReviewFile = JSON.parse(content);

  // Prepare all items for review
  const items: ReviewItem[] = [
    ...reviewFile.groupings.map((g, i) => ({ type: 'grouping' as const, index: i, data: g })),
    ...reviewFile.ungrouped.map((u, i) => ({ type: 'ungrouped' as const, index: i, data: u })),
  ];

  if (items.length === 0) {
    console.log('No items to review!');
    return;
  }

  let currentIndex = 0;
  let quit = false;

  // Setup raw mode for keypress events
  if (stdin.isTTY) {
    stdin.setRawMode(true);
  }
  stdin.resume();
  stdin.setEncoding('utf8');

  // Display first item
  displayGrouping(items[currentIndex], currentIndex, items.length);

  // Handle keypresses
  const onKeypress = (key: string) => {
    // Handle Ctrl+C
    if (key === '\u0003') {
      quit = true;
      cleanup();
      return;
    }

    const lowerKey = key.toLowerCase();
    const currentItem = items[currentIndex];
    const isMCPGrouping = currentItem.type === 'grouping' && (currentItem.data as Grouping).groupType === 'mcp-server';

    switch (lowerKey) {
      case '1': // MCP: Approve entire server
        if (isMCPGrouping && currentItem.type === 'grouping') {
          const grouping = currentItem.data as Grouping;
          grouping.approved = true;
          grouping.mcpChoice = 'server';
          if (currentIndex < items.length - 1) {
            currentIndex++;
          }
          displayGrouping(items[currentIndex], currentIndex, items.length);
        }
        break;

      case '2': // MCP: Approve individual commands
        if (isMCPGrouping && currentItem.type === 'grouping') {
          const grouping = currentItem.data as Grouping;
          grouping.approved = true;
          grouping.mcpChoice = 'individual';
          if (currentIndex < items.length - 1) {
            currentIndex++;
          }
          displayGrouping(items[currentIndex], currentIndex, items.length);
        }
        break;

      case 'a': // Approve (standard, not for MCP groupings)
        if (!isMCPGrouping) {
          items[currentIndex].data.approved = true;
          if (currentIndex < items.length - 1) {
            currentIndex++;
          }
          displayGrouping(items[currentIndex], currentIndex, items.length);
        }
        break;

      case 'd': // Deny
        items[currentIndex].data.approved = false;
        // Clear MCP choice if denying
        if (currentItem.type === 'grouping') {
          (currentItem.data as Grouping).mcpChoice = undefined;
        }
        if (currentIndex < items.length - 1) {
          currentIndex++;
        }
        displayGrouping(items[currentIndex], currentIndex, items.length);
        break;

      case 's': // Skip
        items[currentIndex].data.approved = null;
        // Clear MCP choice if skipping
        if (currentItem.type === 'grouping') {
          (currentItem.data as Grouping).mcpChoice = undefined;
        }
        if (currentIndex < items.length - 1) {
          currentIndex++;
        }
        displayGrouping(items[currentIndex], currentIndex, items.length);
        break;

      case 'n': // Next
        if (currentIndex < items.length - 1) {
          currentIndex++;
          displayGrouping(items[currentIndex], currentIndex, items.length);
        }
        break;

      case 'p': // Previous
        if (currentIndex > 0) {
          currentIndex--;
          displayGrouping(items[currentIndex], currentIndex, items.length);
        }
        break;

      case 'q': // Quit and save
        quit = true;
        cleanup();
        break;
    }
  };

  const cleanup = async () => {
    stdin.removeListener('data', onKeypress);
    if (stdin.isTTY) {
      stdin.setRawMode(false);
    }
    stdin.pause();

    if (quit) {
      clearScreen();

      // Update review file with changes
      console.log('\n💾 Saving changes...\n');

      // Separate back into groupings and ungrouped
      const updatedGroupings = items
        .filter(item => item.type === 'grouping')
        .map(item => item.data as Grouping);

      const updatedUngrouped = items
        .filter(item => item.type === 'ungrouped')
        .map(item => item.data as UngroupedCommand);

      reviewFile.groupings = updatedGroupings;
      reviewFile.ungrouped = updatedUngrouped;

      await writeFile(reviewFilePath, JSON.stringify(reviewFile, null, 2), 'utf-8');

      // Show summary
      const approvedCount = items.filter(item => item.data.approved === true).length;
      const deniedCount = items.filter(item => item.data.approved === false).length;
      const skippedCount = items.filter(item => item.data.approved === null).length;

      console.log('✅ Review saved!\n');
      console.log('📊 Summary:');
      console.log(`   ✅ Approved: ${approvedCount}`);
      console.log(`   ❌ Denied: ${deniedCount}`);
      console.log(`   ⏸️  Skipped: ${skippedCount}`);
      console.log(`\n📁 File: ${reviewFilePath}`);
      console.log(`\n💡 Next step: Run "claude-commands apply ${reviewFilePath.split('/').pop()}"\n`);

      process.exit(0);
    }
  };

  stdin.on('data', onKeypress);
}
