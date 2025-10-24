#!/usr/bin/env tsx

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { ProjectsMap, SessionInfo, ProjectInfo, JSONLEntry } from './types.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

/**
 * Parse a single JSONL file to extract session information AND project path
 */
async function parseSessionFile(filePath: string, filterDate: Date): Promise<{ session: SessionInfo; projectPath: string } | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) return null;

    let sessionId = '';
    let branch = '';
    let lastActivity = '';
    let projectPath = '';

    // Parse each JSONL entry
    for (const line of lines) {
      try {
        const entry: JSONLEntry = JSON.parse(line);

        // Extract session info from first entry
        if (!sessionId && entry.sessionId) {
          sessionId = entry.sessionId;
        }
        if (!branch && entry.gitBranch) {
          branch = entry.gitBranch;
        }
        if (!projectPath && entry.cwd) {
          projectPath = entry.cwd;
        }
        if (entry.timestamp) {
          lastActivity = entry.timestamp;
        }
      } catch (e) {
        // Skip malformed lines
        continue;
      }
    }

    if (!sessionId || !projectPath) return null;

    // Filter by date
    const activityDate = new Date(lastActivity);
    if (activityDate < filterDate) {
      return null;
    }

    return {
      session: {
        id: sessionId,
        branch: branch || 'unknown',
        lastActivity,
      },
      projectPath,
    };
  } catch (error) {
    console.error(`Error parsing session file ${filePath}:`, error);
    return null;
  }
}

/**
 * Discover all Claude Code sessions grouped by project
 */
export async function discoverSessions(filterDate: Date): Promise<ProjectsMap> {
  const projectsMap: ProjectsMap = {};

  try {
    const projectDirs = await readdir(PROJECTS_DIR);

    for (const encodedPath of projectDirs) {
      const projectDir = join(PROJECTS_DIR, encodedPath);

      try {
        const files = await readdir(projectDir);
        const sessionFiles = files.filter(f => f.endsWith('.jsonl'));

        for (const file of sessionFiles) {
          const result = await parseSessionFile(join(projectDir, file), filterDate);
          if (result) {
            const { session, projectPath } = result;

            // Initialize project if not exists
            if (!projectsMap[projectPath]) {
              projectsMap[projectPath] = {
                path: projectPath,
                sessions: [],
                worktreeCount: 0,
                branches: [],
              };
            }

            // Add session to project
            projectsMap[projectPath].sessions.push(session);
          }
        }
      } catch (error) {
        // Skip directories that can't be read
        continue;
      }
    }

    // Calculate branches and worktree counts for each project
    for (const projectPath in projectsMap) {
      const project = projectsMap[projectPath];
      const branches = [...new Set(project.sessions.map(s => s.branch))];
      project.branches = branches;
      project.worktreeCount = branches.length;
    }

    return projectsMap;
  } catch (error) {
    console.error('Error discovering sessions:', error);
    return {};
  }
}

/**
 * Get the filter date based on last run or 7 days ago
 */
export function getFilterDate(lastRunDate: string | null): Date {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  if (!lastRunDate) {
    return sevenDaysAgo;
  }

  const lastRun = new Date(lastRunDate);
  return lastRun > sevenDaysAgo ? lastRun : sevenDaysAgo;
}

/**
 * Format session list for display
 */
export function formatSessionsList(projectsMap: ProjectsMap): string {
  const projects = Object.values(projectsMap);

  if (projects.length === 0) {
    return 'No active Claude Code sessions found.';
  }

  let output = '\nActive Claude Code Sessions\n';
  output += '══════════════════════════════════════════════════════\n\n';

  for (const project of projects) {
    output += `📁 ${project.path}\n`;
    output += `   Branches: ${project.branches.join(', ')}\n`;
    output += `   Worktrees: ${project.worktreeCount}\n`;
    output += `   Sessions: ${project.sessions.length}\n`;

    // Find most recent session
    const sortedSessions = [...project.sessions].sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    );
    const mostRecent = sortedSessions[0];
    const lastActivityDate = new Date(mostRecent.lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - lastActivityDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    let timeAgo = '';
    if (diffDays > 0) {
      timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
      timeAgo = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffMins > 0) {
      timeAgo = `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    } else {
      timeAgo = 'just now';
    }

    output += `   Last active: ${timeAgo}\n\n`;
  }

  const totalSessions = projects.reduce((sum, p) => sum + p.sessions.length, 0);
  const totalWorktrees = projects.reduce((sum, p) => sum + p.worktreeCount, 0);

  output += `Total: ${projects.length} project${projects.length > 1 ? 's' : ''}, `;
  output += `${totalWorktrees} worktree${totalWorktrees > 1 ? 's' : ''}, `;
  output += `${totalSessions} session${totalSessions > 1 ? 's' : ''}\n`;

  return output;
}
