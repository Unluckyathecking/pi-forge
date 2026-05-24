#!/usr/bin/env node
/**
 * Pi Forge CLI
 *
 * Entry point for the pi-forge command-line interface.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ForgeOrchestrator } from '../core/orchestrator.js';
import { GitCliAdapter, execGit } from '../adapters/git.js';
import { FilesystemStateAdapter } from '../adapters/state.js';
import { LocalCommandVerifier } from '../adapters/verifier.js';
import { SimplePlannerAdapter } from '../adapters/planner.js';
import { PiSdkWorkerAdapter } from '../adapters/worker.js';
import { loadConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { ForgeError } from '../core/errors.js';
import type { EvidenceLedger, FailedTaskMarker, ForgeConfig } from '../core/types.js';

const PI_FORGE_VERSION = resolveVersion();
const program = new Command();

program
  .name('pi-forge')
  .description('Pi Forge — Proof-carrying autonomous coding factory')
  .version(PI_FORGE_VERSION);

interface ForgeCommandOptions {
  config?: string;
  dryRun?: boolean;
  verbose?: boolean;
  noWorker?: boolean;
  kimiKey?: string;
  model?: string;
  provider?: string;
  keepOnFail?: boolean;
  tasks?: string;
}

interface CleanupCommandOptions {
  failed?: boolean;
  olderThan?: string;
  task?: string;
  yes?: boolean;
}

interface SalvageCommandOptions {
  toBranch?: string;
}

program
  .command('forge')
  .description('Execute a goal through Pi Forge')
  .argument('<goal>', 'The goal to accomplish')
  .option('-c, --config <path>', 'Path to config file')
  .option('-d, --dry-run', 'Plan only, do not execute')
  .option('-v, --verbose', 'Verbose output')
  .option('--no-worker', 'Disable the Pi SDK worker (gates-only mode)')
  .option('--kimi-key <key>', 'Kimi Coding API key (sk-kimi-…). Falls back to $KIMI_CODER_API_KEY, then to OAuth in ~/.pi/agent/auth.json.')
  .option('--model <id>', 'Model id within the provider (default: kimi-for-coding)')
  .option('--provider <name>', 'Provider name (default: kimi-coder)')
  .option('--keep-on-fail', 'Preserve worktree on gate failure (overrides config)')
  .option('--tasks <list>', 'Comma-separated task IDs to run (e.g. "implement" or "plan,implement"). Skips others from the decomposed graph.')
  .action(async (goal: string, options: ForgeCommandOptions) => {
    if (options.verbose === true) {
      process.env.LOG_LEVEL = 'debug';
    }

    const spinner = ora('Loading configuration...').start();
    try {
      const loaded = await loadConfig(options.config);
      // --keep-on-fail is a per-run override that always wins over
      // config.yaml. Use an immutable spread so the cached config
      // returned by getConfig() is not mutated as a side-effect.
      const config: ForgeConfig =
        options.keepOnFail === true
          ? { ...loaded, git: { ...loaded.git, preserve_worktree_on_failure: true } }
          : loaded;
      spinner.succeed('Configuration loaded');

      const git = new GitCliAdapter();
      const state = new FilesystemStateAdapter();
      const verifier = new LocalCommandVerifier();
      const planner = new SimplePlannerAdapter();
      let worker: PiSdkWorkerAdapter | undefined;

      await git.init(process.cwd());
      await state.init('.pi/state');
      await verifier.init(process.cwd(), buildGateConfig(config));

      if (options.noWorker === true) {
        spinner.info('Worker disabled via --no-worker; running in gates-only mode');
      } else {
        worker = new PiSdkWorkerAdapter();
        try {
          await worker.init({
            projectRoot: process.cwd(),
            kimiApiKey: options.kimiKey ?? process.env.KIMI_CODER_API_KEY,
            modelId: options.model,
            providerName: options.provider,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          spinner.warn(`Pi SDK worker unavailable; falling back to gates-only mode (${message})`);
          worker = undefined;
        }
      }

      const orchestrator = new ForgeOrchestrator({
        config,
        git,
        state,
        verifier,
        planner,
        worker,
        logger: createLogger('orchestrator'),
      });

      const tasksFilter = options.tasks
        ? options.tasks.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        : undefined;

      if (options.dryRun === true) {
        console.log(chalk.blue('Dry run mode — planning only'));
        const graph = await planner.decompose({
          goal,
          tasks: tasksFilter,
          projectRoot: process.cwd(),
        });
        console.log(chalk.green(`Planned ${graph.tasks.length} tasks:`));
        for (const task of graph.tasks) {
          console.log(`  [L${task.level}] ${task.id}: ${task.title}`);
        }
        return;
      }

      const abortController = new AbortController();
      const onSigint = (): void => {
        spinner.warn('SIGINT received; aborting active task');
        abortController.abort(new Error('SIGINT'));
      };
      process.once('SIGINT', onSigint);

      try {
        const ledger = await orchestrator.executeGoal(goal, undefined, abortController.signal, {
          tasks: tasksFilter,
          projectRoot: process.cwd(),
        });
        printResults(ledger);
        process.exit(ledger.summary?.final_status === 'success' ? 0 : 1);
      } finally {
        process.off('SIGINT', onSigint);
      }
    } catch (err) {
      spinner.fail('Execution failed');
      handleError(err);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show status of the current Pi Forge session')
  .option('-g, --goal <id>', 'Goal ID to query')
  .action(async (options: { goal?: string }) => {
    try {
      const state = new FilesystemStateAdapter();
      await state.init('.pi/state');

      if (!options.goal) {
        const graphs = await state.listTaskGraphs();
        console.log(chalk.blue('Active goals:'));
        for (const gid of graphs) {
          console.log(`  ${gid}`);
        }
        return;
      }

      const graph = await state.loadTaskGraph(options.goal);
      const ledger = await state.loadEvidenceLedger(options.goal);

      if (!graph) {
        console.log(chalk.red(`Goal not found: ${options.goal}`));
        process.exit(1);
      }

      console.log(chalk.blue(`Goal: ${graph.goal_id}`));
      console.log(chalk.gray(`Tasks: ${graph.tasks.length}`));
      console.log(chalk.gray(`Completed: ${graph.tasks.filter((t) => t.status === 'completed').length}`));

      if (ledger) {
        console.log(chalk.gray(`Evidence entries: ${ledger.entries.length}`));
        if (ledger.summary) {
          console.log(chalk.gray(`Final status: ${ledger.summary.final_status}`));
        }
      }
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

program
  .command('checkpoint')
  .description('Write a recovery checkpoint')
  .action(async () => {
    console.log(chalk.yellow('Checkpoint command requires an active session.'));
    console.log(chalk.gray('Use "pi-forge forge <goal>" to start a session.'));
  });

program
  .command('cleanup')
  .description('Purge preserved failed tasks (worktree + tag ref + marker)')
  .option('--failed', 'Purge only preserved failed tasks (default scope)')
  .option(
    '--older-than <duration>',
    'Only purge failures older than this (e.g. 7d, 24h, 30m)',
    '0d',
  )
  .option('--task <id>', 'Purge a specific task only')
  .option('--yes', 'Skip confirmation prompt (required for non-empty purges)')
  .action(async (options: CleanupCommandOptions) => {
    try {
      const state = new FilesystemStateAdapter();
      await state.init('.pi/state');
      const git = new GitCliAdapter();
      await git.init(process.cwd());

      const cutoffMs = parseDurationMs(options.olderThan ?? '0d');
      const candidates = await collectPurgeCandidates(state, options.task, cutoffMs);

      if (candidates.length === 0) {
        console.log(chalk.gray('No preserved failed tasks match the filter.'));
        return;
      }

      if (options.yes !== true) {
        console.log(
          chalk.yellow(`Would purge ${candidates.length} preserved failed task(s):`),
        );
        for (const marker of candidates) {
          console.log(
            chalk.gray(
              `  ${marker.task_id}  (failed ${marker.failed_at}, branch ${marker.branch})`,
            ),
          );
        }
        console.log('');
        console.log(chalk.yellow('Rerun with --yes to actually purge.'));
        return;
      }

      for (const marker of candidates) {
        const parts: string[] = [];
        if (marker.worktree_path !== undefined && (await pathExists(marker.worktree_path))) {
          try {
            // Don't delete the branch — it may have been salvaged elsewhere.
            await git.destroyWorktree(marker.worktree_path, false);
            parts.push('worktree');
          } catch (err) {
            console.error(
              chalk.yellow(
                `  warn: failed to remove worktree ${marker.worktree_path}: ${errMessage(err)}`,
              ),
            );
          }
        }

        try {
          await git.deleteRef(marker.tag_ref);
          parts.push('tag');
        } catch (err) {
          // Best-effort: a missing ref shouldn't block the marker delete.
          const msg = errMessage(err);
          if (!/not exist|no such ref|unknown ref|ENOENT/i.test(msg)) {
            console.error(
              chalk.yellow(`  warn: failed to delete ref ${marker.tag_ref}: ${msg}`),
            );
          }
        }

        await state.deleteFailedMarker(marker.task_id);
        parts.push('marker');

        console.log(
          chalk.green(`✔ purged ${marker.task_id} (${parts.join(', ')})`),
        );
      }
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

program
  .command('inspect')
  .description('Show a structured summary of a preserved failed task')
  .argument('<task-id>', 'The id of the failed task to inspect')
  .action(async (taskId: string) => {
    try {
      const state = new FilesystemStateAdapter();
      await state.init('.pi/state');
      const git = new GitCliAdapter();
      await git.init(process.cwd());

      const marker = await state.loadFailedMarker(taskId);
      if (!marker) {
        console.error(
          chalk.red(`No preserved failed task found for "${taskId}".`),
        );
        console.error(
          chalk.gray(
            'List candidates with: pi-forge cleanup --failed --older-than 0d  (no --yes shows the list)',
          ),
        );
        process.exit(1);
        return;
      }

      console.log(renderInspect(marker));

      if (
        marker.worktree_path !== undefined &&
        (await pathExists(marker.worktree_path))
      ) {
        try {
          const { stdout } = await execGit(
            ['status', '--porcelain'],
            marker.worktree_path,
          );
          const lines = stdout.split('\n').filter((l) => l.trim() !== '');
          if (lines.length > 0) {
            console.log(chalk.bold('Worktree status (last 5 entries):'));
            for (const line of lines.slice(-5)) {
              console.log(chalk.gray(`  ${line}`));
            }
            console.log('');
          }
        } catch {
          // best-effort context; never block inspect on git status failure.
        }
      }
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

program
  .command('salvage')
  .description('Promote a preserved failed task to a regular branch')
  .argument('<task-id>', 'The id of the failed task to salvage')
  .option('--to-branch <name>', 'Target branch name (default salvaged/<task-id>)')
  .action(async (taskId: string, options: SalvageCommandOptions) => {
    try {
      const state = new FilesystemStateAdapter();
      await state.init('.pi/state');
      const git = new GitCliAdapter();
      await git.init(process.cwd());

      const marker = await state.loadFailedMarker(taskId);
      if (!marker) {
        console.error(chalk.red(`No preserved failed task found for "${taskId}".`));
        process.exit(1);
        return;
      }

      const targetBranch =
        options.toBranch !== undefined && options.toBranch.length > 0
          ? options.toBranch
          : `salvaged/${taskId}`;

      let finalWorktreePath: string | undefined;
      if (
        marker.worktree_path !== undefined &&
        (await pathExists(marker.worktree_path))
      ) {
        const newPath = stripFailedSuffix(marker.worktree_path);
        if (newPath !== marker.worktree_path) {
          finalWorktreePath = await git.moveWorktree(marker.worktree_path, newPath);
        } else {
          finalWorktreePath = marker.worktree_path;
        }
      }

      if (marker.branch !== targetBranch) {
        const { exitCode, stderr } = await execGit(
          ['branch', '-m', marker.branch, targetBranch],
          process.cwd(),
        );
        if (exitCode !== 0) {
          console.error(
            chalk.red(
              `Failed to rename branch ${marker.branch} -> ${targetBranch}: ${stderr}`,
            ),
          );
          process.exit(1);
          return;
        }
      }

      try {
        await git.deleteRef(marker.tag_ref);
      } catch (err) {
        const msg = errMessage(err);
        if (!/not exist|no such ref|unknown ref|ENOENT/i.test(msg)) {
          console.error(
            chalk.yellow(`  warn: failed to delete ref ${marker.tag_ref}: ${msg}`),
          );
        }
      }

      await state.deleteFailedMarker(taskId);

      console.log(
        chalk.green(`✔ salvaged ${taskId} → branch ${targetBranch}`),
      );
      if (finalWorktreePath !== undefined) {
        console.log(chalk.gray(`  worktree: ${finalWorktreePath}`));
      }
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

// Only auto-parse when invoked as the entry script (the `pi-forge` bin).
// Guarding this keeps `import { ... } from '../../src/cli/index.js'` safe
// for unit tests that exercise the exported helpers. We resolve argv[1]
// through realpath because Node returns the realpath in import.meta.url
// but leaves argv[1] as-supplied (matters when /tmp → /private/tmp on
// macOS, or when invoked via a symlinked bin in node_modules/.bin).
if (process.argv[1] !== undefined && isEntryScript(process.argv[1])) {
  program.parse();
}

function isEntryScript(argv1: string): boolean {
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

// ── Helpers ──

interface MechanicalGateConfig {
  readonly enabled: boolean;
  readonly fail_on_error?: boolean;
  readonly timeout_seconds?: number;
  readonly coverage_threshold?: number;
}

function buildGateConfig(config: ForgeConfig): Record<string, MechanicalGateConfig> {
  const { lint, typecheck, test, build, security_scan } = config.gates.mechanical;
  return {
    lint: { enabled: lint.enabled, fail_on_error: lint.fail_on_error },
    typecheck: { enabled: typecheck.enabled, fail_on_error: typecheck.fail_on_error },
    test: {
      enabled: test.enabled,
      fail_on_error: test.require_pass,
      timeout_seconds: test.timeout_seconds,
      coverage_threshold: test.coverage_threshold,
    },
    build: {
      enabled: build.enabled,
      fail_on_error: build.fail_on_error,
      timeout_seconds: build.timeout_seconds,
    },
    security_scan: {
      enabled: security_scan.enabled,
      fail_on_error: security_scan.fail_on_critical,
    },
  };
}

function printResults(ledger: EvidenceLedger): void {
  console.log('');
  const status = ledger.summary?.final_status ?? 'unknown';
  const statusColor = status === 'success' ? chalk.green : status === 'partial' ? chalk.yellow : chalk.red;
  console.log(statusColor.bold(`Result: ${status.toUpperCase()}`));
  console.log(chalk.gray(`Tasks completed: ${ledger.summary?.tasks_completed ?? 0}`));
  console.log(chalk.gray(`Tasks failed: ${ledger.summary?.tasks_failed ?? 0}`));
  console.log(chalk.gray(`Evidence entries: ${ledger.entries.length}`));
  console.log('');

  const failures = ledger.entries.filter((e) => e.type === 'task_failed');
  if (failures.length > 0) {
    console.log(chalk.red.bold('Failures:'));
    for (const f of failures) {
      console.log(chalk.red(`  [${f.task_id}] ${f.description}`));
    }
  }
}

function resolveVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/cli/index.ts → dist/cli/index.js → package.json is two levels up
    const pkgPath = join(here, '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function handleError(err: unknown): void {
  if (err instanceof ForgeError) {
    console.error(chalk.red(`[${err.code}] ${err.message}`));
    if (err.context && Object.keys(err.context).length > 0) {
      console.error(chalk.gray(JSON.stringify(err.context, null, 2)));
    }
  } else if (err instanceof Error) {
    console.error(chalk.red(err.message));
    if (process.env.LOG_LEVEL === 'debug') {
      console.error(err.stack);
    }
  } else {
    console.error(chalk.red(String(err)));
  }
}

// ── Helpers for cleanup / inspect / salvage ──

export function parseDurationMs(spec: string): number {
  const m = /^(\d+)([dhm])$/.exec(spec.trim());
  if (!m) {
    throw new Error(`Invalid duration: ${spec}. Use e.g. 7d, 24h, 30m.`);
  }
  const n = parseInt(m[1], 10);
  const unit = m[2];
  switch (unit) {
    case 'd':
      return n * 24 * 3600 * 1000;
    case 'h':
      return n * 3600 * 1000;
    case 'm':
      return n * 60 * 1000;
    default:
      return 0;
  }
}

/**
 * Strip the `.failed` (or configured) suffix plus any `-<unix-ts>` collision
 * tag from a preserved-worktree path so salvage can rename the worktree back
 * to its original "live" location. Returns the input unchanged when the
 * pattern doesn't match — caller decides whether to skip the rename.
 */
export function stripFailedSuffix(path: string): string {
  // We don't read the live config here; the suffix regex covers the default
  // and any custom suffix that ends in `.failed`. If the operator chose a
  // wildly different suffix, the input is returned unchanged and the
  // worktree just keeps its current path post-salvage.
  return path.replace(/\.failed(-\d+)?$/, '');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function collectPurgeCandidates(
  state: FilesystemStateAdapter,
  taskFilter: string | undefined,
  cutoffMs: number,
): Promise<FailedTaskMarker[]> {
  const taskIds =
    taskFilter !== undefined && taskFilter.length > 0
      ? [taskFilter]
      : await state.listFailedMarkers();

  const now = Date.now();
  const out: FailedTaskMarker[] = [];
  for (const id of taskIds) {
    const marker = await state.loadFailedMarker(id);
    if (!marker) continue;
    if (cutoffMs > 0) {
      const failedAt = Date.parse(marker.failed_at);
      if (!Number.isNaN(failedAt) && now - failedAt < cutoffMs) {
        continue;
      }
    }
    out.push(marker);
  }
  return out;
}

/**
 * Pure rendering helper for `pi-forge inspect`. Returns a single string
 * containing the header, gate table, diff stats, recovery hint, and the
 * ready-to-copy operator command lines.
 */
export function renderInspect(marker: FailedTaskMarker): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`Preserved failed task: ${marker.task_id}`));
  lines.push(chalk.gray(`  goal_id:      ${marker.goal_id}`));
  lines.push(chalk.gray(`  failed_at:    ${marker.failed_at}`));
  lines.push(chalk.gray(`  failure_kind: ${marker.failure_kind}`));
  lines.push(chalk.gray(`  branch:       ${marker.branch}`));
  lines.push(chalk.gray(`  commit_sha:   ${marker.commit_sha}`));
  lines.push(chalk.gray(`  tag_ref:      ${marker.tag_ref}`));
  if (marker.worktree_path !== undefined) {
    lines.push(chalk.gray(`  worktree:     ${marker.worktree_path}`));
  }
  if (marker.wip_commit_was_empty) {
    lines.push(chalk.gray('  wip_commit:   (empty)'));
  }
  lines.push('');

  lines.push(chalk.bold('Gates:'));
  if (marker.gates.length === 0) {
    lines.push(chalk.gray('  (no gate results captured)'));
  } else {
    const nameWidth = Math.max(4, ...marker.gates.map((g) => g.name.length));
    const statusWidth = Math.max(
      6,
      ...marker.gates.map((g) => g.status.length),
    );
    lines.push(
      chalk.gray(
        `  ${'name'.padEnd(nameWidth)}  ${'status'.padEnd(statusWidth)}  exit  stderr`,
      ),
    );
    for (const g of marker.gates) {
      const color =
        g.status === 'pass'
          ? chalk.green
          : g.status === 'warn'
            ? chalk.yellow
            : g.status === 'skip'
              ? chalk.gray
              : chalk.red;
      const stderrHead = g.stderr_first_line ?? '';
      lines.push(
        `  ${color(g.name.padEnd(nameWidth))}  ${color(g.status.padEnd(statusWidth))}  ${String(g.exit_code).padStart(4)}  ${chalk.gray(stderrHead)}`,
      );
    }
  }
  lines.push('');

  lines.push(chalk.bold('Diff:'));
  lines.push(
    chalk.gray(
      `  +${marker.lines_added} / -${marker.lines_removed} across ${marker.files_modified.length} file(s)`,
    ),
  );
  lines.push('');

  lines.push(chalk.bold('Recovery hint:'));
  lines.push(chalk.gray(`  ${marker.recovery_hint}`));
  lines.push('');

  lines.push(chalk.bold('Operator commands:'));
  lines.push(`  ${chalk.cyan('inspect')}  ${marker.operator_commands.inspect}`);
  lines.push(`  ${chalk.cyan('salvage')}  ${marker.operator_commands.salvage}`);
  lines.push(`  ${chalk.cyan('retry')}    ${marker.operator_commands.retry}`);
  lines.push(`  ${chalk.cyan('purge')}    ${marker.operator_commands.purge}`);
  lines.push('');

  return lines.join('\n');
}
