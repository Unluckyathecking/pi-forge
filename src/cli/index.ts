#!/usr/bin/env node
/**
 * Pi Forge CLI
 *
 * Entry point for the pi-forge command-line interface.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
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
import { pMap } from '../utils/helpers.js';
import { ForgeError } from '../core/errors.js';
import { detectProjectType, renderPlanMarkdown } from './plan-template.js';
import type { PlanTemplateInput, ProjectType } from './plan-template.js';
import type {
  EvidenceEntry,
  EvidenceLedger,
  FailedTaskMarker,
  ForgeConfig,
  TaskGraph,
} from '../core/types.js';

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

interface StatsCommandOptions {
  readonly goal?: string;
  readonly last?: string;
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

interface WatchCommandOptions {
  interval?: string;
}

program
  .command('watch')
  .description('Tail the evidence ledger + active worktree for a running goal')
  .argument('<goalId>', 'Goal ID returned by `pi-forge forge`')
  .option('--interval <ms>', 'Refresh interval in ms', '2000')
  .action(async (goalId: string, options: WatchCommandOptions) => {
    try {
      const state = new FilesystemStateAdapter();
      await state.init('.pi/state');
      const intervalMs = parseInt(options.interval ?? '2000', 10);
      await runWatchLoop(state, goalId, intervalMs);
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

program
  .command('stats')
  .description('Show session statistics across all pi-forge goals')
  .option('--goal <id>', 'Drill into a specific goal')
  .option('--last <n>', 'Recent-goals limit (default 10)', '10')
  .action(async (options: StatsCommandOptions) => {
    try {
      const state = new FilesystemStateAdapter();
      await state.init('.pi/state');
      if (options.goal !== undefined) {
        await renderGoalStats(state, options.goal);
      } else {
        const last = parseInt(options.last ?? '10', 10);
        await renderAggregateStats(state, isNaN(last) ? 10 : last);
      }
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

interface InitPlanCommandOptions {
  // Commander rewrites `--no-prompt` to `prompt: false` (negated boolean).
  // Default is `true` when the flag is absent.
  readonly prompt?: boolean;
  readonly output?: string;
  readonly goal?: string;
  readonly scopeIn?: string;
  readonly scopeOut?: string;
}

const DEFAULT_STRICT_PREFS: readonly string[] = [
  'no-any',
  'no-as',
  'no-console-log',
  'import-type',
  'verbatim-module-syntax',
];

program
  .command('init-plan')
  .description('Scaffold a comprehensive PLAN.md interactively (or with --no-prompt)')
  .option('--no-prompt', 'Skip prompts; use --goal/--scope-in/--scope-out + placeholders for the rest')
  .option('--goal <text>', 'Goal sentence (≤200 chars). Required with --no-prompt.')
  .option('--scope-in <list>', 'Comma-separated in-scope items')
  .option('--scope-out <list>', 'Comma-separated out-of-scope items')
  .option('--output <path>', 'Output path (default ./PLAN.md)', './PLAN.md')
  .action(async (options: InitPlanCommandOptions) => {
    try {
      const outputPath = resolve(options.output ?? './PLAN.md');
      const projectType = detectProjectType(process.cwd());

      const interactive = options.prompt !== false;

      let input: PlanTemplateInput;
      if (!interactive) {
        if (options.goal === undefined || options.goal.length === 0) {
          console.error(chalk.red('--no-prompt requires --goal'));
          process.exit(1);
          return;
        }
        input = {
          goal: options.goal,
          scopeIn: splitCsv(options.scopeIn ?? ''),
          scopeOut: splitCsv(options.scopeOut ?? ''),
          newFilesEstimate: 0,
          editedFilesEstimate: 0,
          strictPrefs: DEFAULT_STRICT_PREFS,
          includeUnitTests: false,
          projectType,
        };
      } else {
        input = await runInitPlanPrompts(projectType);
      }

      if (existsSync(outputPath)) {
        const overwrite = !interactive
          ? true // --no-prompt + existing PLAN.md = overwrite (CI semantics).
          : await confirmOverwrite(outputPath);
        if (!overwrite) {
          console.log(chalk.yellow('Aborted (existing PLAN.md preserved).'));
          return;
        }
      }

      const markdown = renderPlanMarkdown(input);
      writeFileSync(outputPath, markdown, 'utf-8');
      const lineCount = markdown.split('\n').length;
      console.log(chalk.green(`✓ wrote ${outputPath} (${lineCount} lines)`));
      console.log();
      console.log(chalk.bold('Next steps:'));
      console.log(
        chalk.gray(
          `  1. Edit ${outputPath} to fill in your specific File Map, Type Contracts, and Behaviour Matrix.`,
        ),
      );
      console.log(
        chalk.gray(
          `  2. Commit: git add ${outputPath} && git commit -m "docs: PLAN.md for <goal>"`,
        ),
      );
      console.log(
        chalk.gray(
          `  3. Fire: pi-forge forge "feature: Execute PLAN.md to <goal>"`,
        ),
      );
    } catch (err) {
      handleError(err);
      process.exit(1);
    }
  });

function splitCsv(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Async-iterator backed prompt helper. The classic `readline/promises`
 * `rl.question()` API has a known sharp edge with piped stdin where only the
 * first call resolves; using the iterator side of the interface avoids that
 * trap and works identically in real terminals.
 */
async function askLine(
  iter: AsyncIterator<string>,
  prompt: string,
): Promise<string> {
  stdout.write(prompt);
  const result = await iter.next();
  if (result.done === true) return '';
  return typeof result.value === 'string' ? result.value : '';
}

async function runInitPlanPrompts(projectType: ProjectType): Promise<PlanTemplateInput> {
  const rl: ReadlineInterface = createInterface({ input: stdin, output: stdout });
  const iter = rl[Symbol.asyncIterator]();
  console.log(chalk.bold('pi-forge init-plan — scaffold a comprehensive PLAN.md\n'));
  console.log(chalk.gray(`Detected project: ${projectType}\n`));
  try {
    const goalRaw = await askLine(
      iter,
      chalk.cyan('1/7  Goal (one declarative sentence, ≤200 chars):\n> '),
    );
    const scopeInRaw = await askLine(
      iter,
      chalk.cyan('\n2/7  Scope IN (comma-separated):\n> '),
    );
    const scopeOutRaw = await askLine(
      iter,
      chalk.cyan('\n3/7  Scope OUT (comma-separated):\n> '),
    );
    const newFilesRaw = await askLine(
      iter,
      chalk.cyan('\n4/7  How many NEW files? (rough estimate) [10]\n> '),
    );
    const editedFilesRaw = await askLine(
      iter,
      chalk.cyan('\n5/7  How many EXISTING files to edit? [9]\n> '),
    );
    const strictRaw = await askLine(
      iter,
      chalk.cyan(
        `\n6/7  Strict-mode preferences (comma-separated; defaults: ${DEFAULT_STRICT_PREFS.join(
          ', ',
        )}):\n> `,
      ),
    );
    const testsRaw = await askLine(
      iter,
      chalk.cyan('\n7/7  Will you write unit tests? [y/N]\n> '),
    );

    const goal = goalRaw.trim().length > 0 ? goalRaw.trim() : '<TODO: goal sentence>';
    const newFiles = parseEstimate(newFilesRaw, 10);
    const editedFiles = parseEstimate(editedFilesRaw, 9);
    const strictPrefs =
      strictRaw.trim().length === 0 ? DEFAULT_STRICT_PREFS : splitCsv(strictRaw);
    return {
      goal,
      scopeIn: splitCsv(scopeInRaw),
      scopeOut: splitCsv(scopeOutRaw),
      newFilesEstimate: newFiles,
      editedFilesEstimate: editedFiles,
      strictPrefs,
      includeUnitTests: /^y/i.test(testsRaw.trim()),
      projectType,
    };
  } finally {
    rl.close();
  }
}

function parseEstimate(raw: string, fallback: number): number {
  const parsed = parseInt(raw.trim(), 10);
  return Number.isNaN(parsed) || parsed < 0 ? fallback : parsed;
}

async function confirmOverwrite(path: string): Promise<boolean> {
  const rl: ReadlineInterface = createInterface({ input: stdin, output: stdout });
  const iter = rl[Symbol.asyncIterator]();
  try {
    const ans = await askLine(
      iter,
      chalk.yellow(`${path} already exists. Overwrite? [y/N] `),
    );
    return /^y/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// Re-export for testing — keeps the test file pointing at one entry module.
export { detectProjectType, renderPlanMarkdown } from './plan-template.js';
export type { PlanTemplateInput, ProjectType } from './plan-template.js';

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

// ── Helpers for `pi-forge watch` ──

const WATCH_LEDGER_WAIT_MS = 10_000;
const WATCH_WORKTREE_HEARTBEAT_MS = 30_000;

async function runWatchLoop(
  state: FilesystemStateAdapter,
  goalId: string,
  intervalMs: number,
): Promise<void> {
  console.log(
    chalk.gray(
      `[watching ${goalId} — refresh every ${intervalMs}ms, ctrl-c to stop]`,
    ),
  );

  let lastSeq = -1;
  let lastWorktreeFileCount = -1;
  let lastWorktreeUpdate = 0;
  let shouldStop = false;

  const onSigint = (): void => {
    shouldStop = true;
  };
  process.once('SIGINT', onSigint);

  // Wait for the ledger to exist (race against forge starting). Up to 10s.
  const ledgerStart = Date.now();
  while (!shouldStop) {
    const initial = await state.loadEvidenceLedger(goalId);
    if (initial) break;
    if (Date.now() - ledgerStart > WATCH_LEDGER_WAIT_MS) {
      process.off('SIGINT', onSigint);
      throw new Error(
        `Ledger not found for goal '${goalId}' after 10s. Is the goal id correct?`,
      );
    }
    await sleep(500);
  }

  while (!shouldStop) {
    const ledger = await state.loadEvidenceLedger(goalId);
    if (!ledger) break;

    // Print new ledger entries since we last saw the ledger.
    const newEntries = ledger.entries.filter((e) => e.seq > lastSeq);
    for (const entry of newEntries) {
      console.log(renderEntry(entry));
    }
    if (newEntries.length > 0) {
      lastSeq = ledger.entries[ledger.entries.length - 1].seq;
    }

    // For the currently-running task, show worktree activity.
    const activeTask = findActiveTask(ledger);
    if (activeTask?.task_id !== undefined) {
      const wtPath = join(
        process.cwd(),
        '.pi',
        'worktrees',
        goalId,
        activeTask.task_id,
      );
      try {
        const stats = await readWorktreeStats(wtPath);
        const now = Date.now();
        const countChanged = stats.modifiedCount !== lastWorktreeFileCount;
        const heartbeatDue = now - lastWorktreeUpdate > WATCH_WORKTREE_HEARTBEAT_MS;
        if (countChanged || heartbeatDue) {
          const recent =
            stats.mostRecent !== undefined ? ` · ${stats.mostRecent}` : '';
          console.log(
            chalk.gray(
              `  worktree: ${wtPath} (${stats.modifiedCount} files modified${recent})`,
            ),
          );
          lastWorktreeFileCount = stats.modifiedCount;
          lastWorktreeUpdate = now;
        }
      } catch {
        // Worktree gone or not yet created — silent.
      }
    }

    // Terminate once the run is finalised.
    if (ledger.summary?.final_status !== undefined) {
      const finalStatus = ledger.summary.final_status;
      const colour =
        finalStatus === 'success'
          ? chalk.green.bold
          : finalStatus === 'partial'
            ? chalk.yellow.bold
            : chalk.red.bold;
      console.log(
        colour(
          `FINAL: ${finalStatus} (${ledger.summary.tasks_completed ?? 0} completed, ${ledger.summary.tasks_failed ?? 0} failed)`,
        ),
      );
      process.off('SIGINT', onSigint);
      process.exit(finalStatus === 'success' ? 0 : 1);
    }

    await sleep(intervalMs);
  }

  process.off('SIGINT', onSigint);
}

/**
 * Format a single evidence-ledger entry for the watch stream.
 * Pure: timestamp comes from `entry.timestamp`, no I/O.
 */
export function renderEntry(entry: EvidenceEntry): string {
  const ts = new Date(entry.timestamp).toLocaleTimeString();
  const taskCol = (entry.task_id ?? '—').padEnd(10);
  const typeCol = entry.type.padEnd(14);
  const desc = (entry.description ?? '').substring(0, 80);
  const colour =
    entry.type === 'task_completed'
      ? chalk.green
      : entry.type === 'task_failed'
        ? chalk.red
        : entry.type === 'task_started'
          ? chalk.blue
          : entry.type === 'merge'
            ? chalk.cyan
            : chalk.white;
  return `${chalk.gray(`[${ts}]`)} ${colour(typeCol)} ${chalk.bold(taskCol)} ${desc}`;
}

/**
 * Find the most-recent `task_started` whose `task_id` has not yet been
 * matched by a `task_completed` or `task_failed`. Returns undefined when
 * nothing is in-flight.
 */
export function findActiveTask(ledger: EvidenceLedger): EvidenceEntry | undefined {
  const finished = new Set<string>();
  for (const e of ledger.entries) {
    if (
      (e.type === 'task_completed' || e.type === 'task_failed') &&
      e.task_id !== undefined
    ) {
      finished.add(e.task_id);
    }
  }
  for (let i = ledger.entries.length - 1; i >= 0; i--) {
    const e = ledger.entries[i];
    if (
      e.type === 'task_started' &&
      e.task_id !== undefined &&
      !finished.has(e.task_id)
    ) {
      return e;
    }
  }
  return undefined;
}

export interface WorktreeStats {
  readonly modifiedCount: number;
  readonly mostRecent?: string;
}

/**
 * Count modified files inside the worktree via `git status --porcelain`.
 * Picks the last porcelain line as `mostRecent` — git emits them in stable
 * (sorted) order, so this is a cheap heuristic, not a true mtime sort. The
 * watcher already throttles output to once per change or every 30s, so a
 * fancier sort isn't worth the extra fs calls.
 */
export async function readWorktreeStats(
  worktreePath: string,
): Promise<WorktreeStats> {
  const proc = spawn('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    env: process.env,
  });
  const stdout = await new Promise<string>((resolve, reject) => {
    let out = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    proc.on('close', (code: number | null) =>
      code === 0 ? resolve(out) : reject(new Error(`git status exited ${code ?? 'null'}`)),
    );
    proc.on('error', reject);
  });
  const lines = stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const last = lines.length > 0 ? lines[lines.length - 1] : undefined;
  // Porcelain v1 lines look like `XY path`. Strip the 2-char status + space.
  return {
    modifiedCount: lines.length,
    mostRecent: last !== undefined ? last.slice(3) : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Helpers for `pi-forge stats` ──

interface AggregateStatsDatum {
  readonly goalId: string;
  readonly ledger: EvidenceLedger;
  readonly graph: TaskGraph;
}

/**
 * Render the cross-goal aggregate view for `pi-forge stats`. Reads every
 * task graph + evidence ledger under `.pi/state/`, then aggregates goal
 * outcomes, task outcomes, task durations, most-common failed gates (from
 * proof artifacts) and the recent-goals tail.
 */
export async function renderAggregateStats(
  state: FilesystemStateAdapter,
  last: number,
): Promise<void> {
  const goalIds = await state.listTaskGraphs();
  if (goalIds.length === 0) {
    console.log(chalk.gray('No pi-forge runs found in .pi/state/evidence/.'));
    return;
  }

  // Load all ledgers + task graphs (skip ones we can't load).
  const data: AggregateStatsDatum[] = (
    await pMap(
      goalIds,
      async (gid) => {
        const ledger = await state.loadEvidenceLedger(gid);
        const graph = await state.loadTaskGraph(gid);
        if (ledger && graph) return { goalId: gid, ledger, graph };
        return null;
      },
      { concurrency: 20 }
    )
  ).filter((d): d is AggregateStatsDatum => d !== null);

  // Aggregate goal-level outcomes.
  const goalStatus = { success: 0, partial: 0, failure: 0, unfinished: 0 };
  for (const { ledger } of data) {
    const status = ledger.summary?.final_status;
    if (status === 'success') goalStatus.success++;
    else if (status === 'partial') goalStatus.partial++;
    else if (status === 'failure') goalStatus.failure++;
    else goalStatus.unfinished++;
  }

  // Aggregate task-level outcomes.
  let taskTotal = 0;
  let taskCompleted = 0;
  let taskFailed = 0;
  let taskUnfinished = 0;
  for (const { graph, ledger } of data) {
    taskTotal += graph.tasks.length;
    const completed = new Set<string>();
    const failed = new Set<string>();
    for (const e of ledger.entries) {
      if (e.task_id !== undefined) {
        if (e.type === 'task_completed') completed.add(e.task_id);
        else if (e.type === 'task_failed') failed.add(e.task_id);
      }
    }
    taskCompleted += completed.size;
    taskFailed += failed.size;
    taskUnfinished += graph.tasks.length - completed.size - failed.size;
  }

  // Task durations (from task_started → task_completed/_failed pairs).
  const durationsMs: number[] = [];
  for (const { ledger } of data) {
    const starts = new Map<string, number>();
    for (const e of ledger.entries) {
      if (e.task_id === undefined) continue;
      if (e.type === 'task_started') {
        starts.set(e.task_id, Date.parse(e.timestamp));
      } else if (e.type === 'task_completed' || e.type === 'task_failed') {
        const start = starts.get(e.task_id);
        if (start !== undefined) {
          durationsMs.push(Date.parse(e.timestamp) - start);
          starts.delete(e.task_id);
        }
      }
    }
  }
  const avgMs =
    durationsMs.length > 0
      ? durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length
      : 0;
  const sortedDurations = [...durationsMs].sort((a, b) => a - b);
  const medianMs =
    sortedDurations.length > 0
      ? sortedDurations[Math.floor(sortedDurations.length / 2)]
      : 0;

  // Most-common failed gates from failure proofs.
  const failedGateCounts = new Map<string, number>();
  const goalGateCounts = await pMap(
    data,
    async ({ goalId }) => {
      const counts = new Map<string, number>();
      const proofIds = await state.listProofArtifacts(goalId);
      await pMap(
        proofIds,
        async (pid) => {
          const proof = await state.loadProofArtifact(goalId, pid);
          if (proof?.all_pass === false && proof.failed_gates) {
            for (const g of proof.failed_gates) {
              counts.set(g, (counts.get(g) ?? 0) + 1);
            }
          }
        },
        { concurrency: 10 }
      );
      return counts;
    },
    { concurrency: 20 }
  );

  for (const counts of goalGateCounts) {
    for (const [g, count] of counts.entries()) {
      failedGateCounts.set(g, (failedGateCounts.get(g) ?? 0) + count);
    }
  }

  // Recent goals.
  const recent = [...data]
    .sort((a, b) => b.ledger.created_at.localeCompare(a.ledger.created_at))
    .slice(0, last);

  // ── Render ──
  const total = data.length;
  const pct = (n: number): number => (total > 0 ? Math.round((n / total) * 100) : 0);
  console.log(chalk.bold('Pi Forge — session statistics\n'));
  console.log(`Goals:                ${chalk.bold(total)} total`);
  console.log(
    `  ${chalk.green('✓ success')}           ${String(goalStatus.success).padStart(3)} (${pct(goalStatus.success)}%)`,
  );
  console.log(
    `  ${chalk.yellow('⚠ partial')}           ${String(goalStatus.partial).padStart(3)} (${pct(goalStatus.partial)}%)`,
  );
  console.log(
    `  ${chalk.red('✗ failure')}           ${String(goalStatus.failure).padStart(3)} (${pct(goalStatus.failure)}%)`,
  );
  console.log(
    `  ${chalk.gray('⏸ unfinished')}        ${String(goalStatus.unfinished).padStart(3)} (${pct(goalStatus.unfinished)}%)`,
  );

  console.log();
  const taskPct = (n: number): number =>
    taskTotal > 0 ? Math.round((n / taskTotal) * 100) : 0;
  console.log(`Tasks:                ${chalk.bold(taskTotal)} total`);
  console.log(
    `  ${chalk.green('✓ completed')}         ${String(taskCompleted).padStart(3)} (${taskPct(taskCompleted)}%)`,
  );
  console.log(
    `  ${chalk.red('✗ failed')}            ${String(taskFailed).padStart(3)} (${taskPct(taskFailed)}%)`,
  );
  console.log(
    `  ${chalk.gray('⏸ unfinished')}        ${String(taskUnfinished).padStart(3)} (${taskPct(taskUnfinished)}%)`,
  );

  if (durationsMs.length > 0) {
    console.log();
    console.log(`Average task duration: ${chalk.bold(formatDuration(avgMs))}`);
    console.log(`Median task duration:  ${chalk.bold(formatDuration(medianMs))}`);
  }

  if (failedGateCounts.size > 0) {
    console.log();
    console.log(chalk.bold('Most-common failed gates:'));
    const sortedGates = [...failedGateCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    for (const [gate, count] of sortedGates) {
      console.log(`  ${gate.padEnd(12)} ${chalk.red(count)}`);
    }
  }

  if (recent.length > 0) {
    console.log();
    console.log(chalk.bold(`Recent goals (last ${recent.length}):`));
    for (const r of recent) {
      const status = r.ledger.summary?.final_status ?? 'unfinished';
      const sigil =
        status === 'success'
          ? chalk.green('✓ success')
          : status === 'partial'
            ? chalk.yellow('⚠ partial')
            : status === 'failure'
              ? chalk.red('✗ failure')
              : chalk.gray('⏸ unfinished');
      const date = r.ledger.created_at.substring(0, 10);
      console.log(
        `  ${r.goalId.padEnd(50)} ${sigil.padEnd(20)} ${chalk.gray(date)}`,
      );
    }
  }
}

/**
 * Render the per-goal drill-down for `pi-forge stats --goal <id>`. Header
 * (created/closed/duration/final_status), task table (id/status/duration/
 * failure reason).
 */
export async function renderGoalStats(
  state: FilesystemStateAdapter,
  goalId: string,
): Promise<void> {
  const ledger = await state.loadEvidenceLedger(goalId);
  const graph = await state.loadTaskGraph(goalId);
  if (!ledger || !graph) {
    console.log(chalk.red(`Goal not found: ${goalId}`));
    process.exit(1);
  }

  const createdShort = ledger.created_at.substring(0, 19).replace('T', ' ');
  const closedShort =
    ledger.closed_at !== undefined
      ? ledger.closed_at.substring(0, 19).replace('T', ' ')
      : '—';
  let durationStr = '—';
  if (ledger.closed_at !== undefined) {
    durationStr = formatDuration(
      Date.parse(ledger.closed_at) - Date.parse(ledger.created_at),
    );
  }
  const status = ledger.summary?.final_status ?? 'unfinished';

  console.log(chalk.bold(`Goal: ${goalId}`));
  console.log(`Created: ${createdShort}`);
  console.log(
    `Closed:  ${closedShort}${durationStr !== '—' ? `  (duration: ${durationStr})` : ''}`,
  );
  console.log(
    `Final:   ${
      status === 'success'
        ? chalk.green(status)
        : status === 'failure'
          ? chalk.red(status)
          : chalk.yellow(status)
    }`,
  );

  console.log();
  console.log(chalk.bold(`Tasks (${graph.tasks.length}):`));
  const completedSet = new Set<string>();
  const failedSet = new Set<string>();
  const starts = new Map<string, number>();
  const taskDurations = new Map<string, number>();
  for (const e of ledger.entries) {
    if (e.task_id === undefined) continue;
    if (e.type === 'task_started') {
      starts.set(e.task_id, Date.parse(e.timestamp));
    } else if (e.type === 'task_completed') {
      completedSet.add(e.task_id);
      const s = starts.get(e.task_id);
      if (s !== undefined) taskDurations.set(e.task_id, Date.parse(e.timestamp) - s);
    } else if (e.type === 'task_failed') {
      failedSet.add(e.task_id);
      const s = starts.get(e.task_id);
      if (s !== undefined) taskDurations.set(e.task_id, Date.parse(e.timestamp) - s);
    }
  }
  for (const t of graph.tasks) {
    const sigil = completedSet.has(t.id)
      ? chalk.green('✓ completed')
      : failedSet.has(t.id)
        ? chalk.red('✗ failed')
        : chalk.gray('⏸ skipped');
    const durRaw = taskDurations.get(t.id);
    const dur = durRaw !== undefined ? formatDuration(durRaw).padStart(6) : '   —  ';
    const reason = failedSet.has(t.id)
      ? ledger.entries.find(
          (e) => e.type === 'task_failed' && e.task_id === t.id,
        )?.description ?? ''
      : '';
    console.log(
      `  ${t.id.padEnd(12)} ${sigil.padEnd(20)} ${dur}  ${chalk.gray(reason.substring(0, 60))}`,
    );
  }
}

/**
 * Format a millisecond duration into a compact human-readable string.
 *   < 1000ms → "Nms"
 *   < 60s    → "Ns"
 *   ≥ 60s    → "Nm Ss"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}
