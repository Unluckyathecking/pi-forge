#!/usr/bin/env node
/**
 * Pi Forge CLI
 *
 * Entry point for the pi-forge command-line interface.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ForgeOrchestrator } from '../core/orchestrator.js';
import { GitCliAdapter } from '../adapters/git.js';
import { FilesystemStateAdapter } from '../adapters/state.js';
import { LocalCommandVerifier } from '../adapters/verifier.js';
import { SimplePlannerAdapter } from '../adapters/planner.js';
import { PiSdkWorkerAdapter } from '../adapters/worker.js';
import { loadConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { ForgeError } from '../core/errors.js';
import type { EvidenceLedger, ForgeConfig } from '../core/types.js';

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

      if (options.dryRun === true) {
        console.log(chalk.blue('Dry run mode — planning only'));
        const graph = await planner.decompose({ goal });
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
        const ledger = await orchestrator.executeGoal(goal, undefined, abortController.signal);
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

program.parse();

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
