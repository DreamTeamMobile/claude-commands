#!/usr/bin/env tsx

import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ProjectsMap, AggregatedCommands, CommandInfo, ProjectSettings } from './types.js';

/**
 * Read settings from a project's .claude directory
 */
async function readProjectSettings(projectPath: string): Promise<ProjectSettings> {
  const settingsFiles = [
    join(projectPath, '.claude', 'settings.json'),
    join(projectPath, '.claude', 'settings.local.json'),
  ];

  let mergedSettings: ProjectSettings = {
    permissions: {
      allow: [],
      deny: [],
      ask: [],
    },
  };

  for (const filePath of settingsFiles) {
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, 'utf-8');
      const settings: ProjectSettings = JSON.parse(content);

      if (settings.permissions) {
        if (settings.permissions.allow) {
          mergedSettings.permissions!.allow!.push(...settings.permissions.allow);
        }
        if (settings.permissions.deny) {
          mergedSettings.permissions!.deny!.push(...settings.permissions.deny);
        }
        if (settings.permissions.ask) {
          mergedSettings.permissions!.ask!.push(...settings.permissions.ask);
        }
      }
    } catch (error) {
      console.error(`Error reading settings from ${filePath}:`, error);
    }
  }

  return mergedSettings;
}

/**
 * Check if a command should be filtered out from aggregation
 */
function shouldFilterCommand(command: string): boolean {
  // Filter out Read commands - too specific to file paths
  if (command.startsWith('Read(')) {
    return true;
  }

  // Filter out Write commands - too specific
  if (command.startsWith('Write(')) {
    return true;
  }

  // Filter out Edit commands - too specific
  if (command.startsWith('Edit(')) {
    return true;
  }

  return false;
}

/**
 * Aggregate commands from all discovered projects
 */
export async function aggregateCommands(projectsMap: ProjectsMap): Promise<AggregatedCommands> {
  const allowedCommandsMap = new Map<string, Set<string>>();
  const deniedCommandsMap = new Map<string, Set<string>>();

  const projects = Object.values(projectsMap);

  for (const project of projects) {
    const settings = await readProjectSettings(project.path);

    if (settings.permissions?.allow) {
      for (const command of settings.permissions.allow) {
        // Skip commands that shouldn't be aggregated
        if (shouldFilterCommand(command)) {
          continue;
        }

        if (!allowedCommandsMap.has(command)) {
          allowedCommandsMap.set(command, new Set());
        }
        allowedCommandsMap.get(command)!.add(project.path);
      }
    }

    if (settings.permissions?.deny) {
      for (const command of settings.permissions.deny) {
        // Skip commands that shouldn't be aggregated
        if (shouldFilterCommand(command)) {
          continue;
        }

        if (!deniedCommandsMap.has(command)) {
          deniedCommandsMap.set(command, new Set());
        }
        deniedCommandsMap.get(command)!.add(project.path);
      }
    }
  }

  const allowedCommands: CommandInfo[] = Array.from(allowedCommandsMap.entries()).map(
    ([command, projectsSet]) => ({
      command,
      projects: Array.from(projectsSet),
    })
  );

  const deniedCommands: CommandInfo[] = Array.from(deniedCommandsMap.entries()).map(
    ([command, projectsSet]) => ({
      command,
      projects: Array.from(projectsSet),
    })
  );

  return {
    allowedCommands,
    deniedCommands,
  };
}
