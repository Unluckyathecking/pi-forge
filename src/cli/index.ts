#!/usr/bin/env node
/**
 * Pi Forge CLI
 *
 * Entry point for the pi-forge command-line interface.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ForgeOrchestrator } from '../core/orchestrator.js';
import { GitCliAdapter } from '../adapters/git.js';
import { FilesystemStateAdapter } from '../adapters/state.js';
import { LocalCommandVerifier } from '../adapters/verifier.js';
import { SimplePlannerAdapter } from '../adapters/planner.js';
import { loadConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { ForgeError } from '../core/errors.js';
import type { EvidenceLedger } from '../core/types.js';

const program = new Command();
// const logger = createLogger('cli');

program
  .name('pi-forge')
  .description('Pi Forge — Proof-carrying autonomous coding factory')
  .version('1.0.0');

program
  .command('forge')
  .description('Execute a goal through Pi Forge')
  .argument('<goal>', 'The goal to accomplish')
  .option('-c, --config <path>', 'Path to config file')
  .option('-d, --dry-run', 'Plan only, do not execute')
  .option('-v, --verbose', 'Verbose output')
  .action(async (goal: string, options: { config?: string; dryRun?: boolean; verbose?: boolean }) => {
    if (options.verbose) {
      process.env.LOG_LEVEL = 'debug';
    }

    const spinner = ora('Loading configuration...').start();
    try {
      const config = await loadConfig(options.config);
      spinner.succeed('Configuration loaded');

      const git = new GitCliAdapter();
      const state = new FilesystemStateAdapter();
      const verifier = new LocalCommandVerifier();
      const planner = new SimplePlannerAdapter();

      await git.init(process.cwd());
      await state.init('.pi/state');
      await verifier.init(process.cwd(), buildGateConfig(config));

      const orchestrator = new ForgeOrchestrator({
        config,
        git,
        state,
        verifier,
        planner,
        logger: createLogger('orchestrator'),
      });

      if (options.dryRun) {
        console.log(chalk.blue('Dry run mode — planning only'));
        const graph = await planner.decompose({ goal });
        console.log(chalk.green(`Planned ${graph.tasks.length} tasks:`));
        for (const task of graph.tasks) {
          console.log(`  [L${task.level}] ${task.id}: ${task.title}`);
        }
        return;
      }

      const ledger = await orchestrator.executeGoal(goal);
      printResults(ledger);
      process.exit(ledger.summary?.final_status === 'success' ? 0 : 1);
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

function buildGateConfig(config: { gates?: { mechanical?: Record<string, unknown> } }): Record<string, { enabled: boolean; fail_on_error?: boolean; timeout_seconds?: number; coverage_threshold?: number }> {
  const result: Record<string, { enabled: boolean; fail_on_error?: boolean; timeout_seconds?: number; coverage_threshold?: number }> = {};
  const mechanical = config.gates?.mechanical;
  if (mechanical) {
    for (const [key, val] of Object.entries(mechanical)) {
      if (key === 'order') continue;
      if (typeof val === 'object' && val !== null && 'enabled' in (val as Record<string, unknown>)) {
        result[key] = val as { enabled: boolean; fail_on_error?: boolean; timeout_seconds?: number; coverage_threshold?: number };
      }
    }
  }
  return result;
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
