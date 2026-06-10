/**
 * Archive maintenance tool — on-demand workspace sweep + last-run status.
 *
 * `dokoro_archive_sweep` runs the conservative sweep from src/utils/archive.ts
 * (stale daily/*.md and old completed/validated plans move into the archive;
 * the current ISO week and files with live advisory claims are never touched).
 * `status_only:true` skips sweeping and pretty-prints `.mcp/archive-status.json`,
 * the observability file every non-dry sweep writes.
 *
 * The sweep is a singleton (`.mcp/archive.lock`): a concurrent run reports
 * `skipped: locked`, which is benign — NOT an error.
 */
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { ToolDefinition } from './registry.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOKORO_PATH } from '../shared/dokoro-utils.js';
import { sweepWorkspace, SweepFileError } from '../utils/archive.js';

const STATUS_FILE = path.join(DOKORO_PATH, '.mcp', 'archive-status.json');

/** Max entries displayed per list; the rest collapse to "+N more". */
const DISPLAY_CAP = 20;

/** Shape of `.mcp/archive-status.json` (written by sweepWorkspace). */
interface ArchiveStatusFile {
  last_run?: string;
  moved_daily?: number;
  archived_plans?: number;
  errors?: SweepFileError[];
  last_error?: string | null;
}

function bulletList(items: string[]): string {
  const shown = items.slice(0, DISPLAY_CAP).map((i) => `  - ${i}`);
  if (items.length > DISPLAY_CAP) shown.push(`  - …(+${items.length - DISPLAY_CAP} more)`);
  return shown.join('\n') + '\n';
}

async function readStatusFile(): Promise<ArchiveStatusFile | null> {
  try {
    return JSON.parse(await fs.readFile(STATUS_FILE, 'utf-8')) as ArchiveStatusFile;
  } catch {
    return null;
  }
}

export const archiveTools: ToolDefinition[] = [
  {
    name: 'dokoro_archive_sweep',
    title: 'Sweep workspace into archive',
    description:
      'Archive stale workspace files: daily/*.md older than olderThanDays move to archive/daily/<ISO week>/ ' +
      '(the current ISO week and files with live advisory claims are NEVER touched), and completed/validated ' +
      'plans older than planOlderThanDays move to .mcp/plans/archive/<YYYY-MM>/ (still listed by dokoro_plan_list, read-only). ' +
      'IMPORTANT: dryRun defaults to FALSE — by default files ARE moved; pass dryRun:true to preview without changing anything. ' +
      'status_only:true skips sweeping entirely and reports .mcp/archive-status.json from the last run.',
    inputSchema: {
      olderThanDays: z.number().int().min(0).optional()
        .describe('Daily files older than this many days are eligible (default 7).'),
      planOlderThanDays: z.number().int().min(0).optional()
        .describe('Completed/validated plans older than this many days are archived (default 30).'),
      dryRun: z.boolean().optional().default(false)
        .describe('Preview only — report what WOULD move without touching anything. Default FALSE (files are moved).'),
      status_only: z.boolean().optional().default(false)
        .describe('Do not sweep; pretty-print .mcp/archive-status.json from the last sweep.'),
    },
    handler: async (args): Promise<CallToolResult> => {
      try {
        const a = args as {
          olderThanDays?: number; planOlderThanDays?: number;
          dryRun?: boolean; status_only?: boolean;
        };

        if (a.status_only) {
          const status = await readStatusFile();
          if (!status) {
            return {
              content: [{ type: 'text', text: `No sweep has run yet — \`${STATUS_FILE}\` does not exist.` }],
            };
          }
          let text = '## 🧹 Archive Status (last sweep)\n\n';
          text += `- **Last run:** ${status.last_run ?? 'unknown'}\n`;
          text += `- **Daily files moved:** ${status.moved_daily ?? 0}\n`;
          text += `- **Plans archived:** ${status.archived_plans ?? 0}\n`;
          text += `- **Errors:** ${status.errors?.length ?? 0}\n`;
          if (status.errors && status.errors.length > 0) {
            text += bulletList(status.errors.map((e) => `${e.path}: ${e.error}`));
          }
          text += `- **Last error:** ${status.last_error ?? 'none'}\n`;
          return { content: [{ type: 'text', text }] };
        }

        const result = await sweepWorkspace({
          olderThanDays: a.olderThanDays,
          planOlderThanDays: a.planOlderThanDays,
          dryRun: a.dryRun ?? false,
        });

        // Benign singleton outcome: another sweep holds the lock.
        if (result.skipped === 'locked') {
          return {
            content: [{
              type: 'text',
              text: 'Sweep skipped — another sweep holds `.mcp/archive.lock` (benign; retry shortly).',
            }],
          };
        }

        // Top-level failure with no work done at all -> tool error.
        if (!result.ok && result.error &&
            result.movedDaily.length === 0 && result.archivedPlans.length === 0 &&
            result.errors.length === 0) {
          return { isError: true, content: [{ type: 'text', text: `archive_sweep failed: ${result.error}` }] };
        }

        let text = '';
        if (result.dryRun) {
          text += '**DRY RUN — nothing moved.** Counts below show what WOULD move.\n\n';
        }
        text += `## 🧹 Workspace Sweep${result.dryRun ? ' (dry run)' : ''}\n\n`;
        text += `- **Daily files ${result.dryRun ? 'would move' : 'moved'}:** ${result.movedDaily.length}\n`;
        if (result.movedDaily.length > 0) {
          text += bulletList(result.movedDaily.map((m) => `${m.from} → ${m.to}`));
        }
        text += `- **Plans ${result.dryRun ? 'would be archived' : 'archived'}:** ${result.archivedPlans.length}\n`;
        if (result.archivedPlans.length > 0) {
          text += bulletList(result.archivedPlans);
        }
        text += `- **Errors:** ${result.errors.length}\n`;
        if (result.errors.length > 0) {
          text += bulletList(result.errors.map((e) => `${e.path}: ${e.error}`));
        }
        if (result.error) {
          text += `- **Sweep error:** ${result.error}\n`;
        }
        if (!result.dryRun) {
          const status = await readStatusFile();
          if (status?.last_error) {
            text += `- **Last error (from .mcp/archive-status.json):** ${status.last_error}\n`;
          }
        }
        return { content: [{ type: 'text', text }] };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `archive_sweep failed: ${msg}` }] };
      }
    },
  },
];
