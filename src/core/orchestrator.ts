/**
 * ForgeOrchestrator — Main execution engine for Pi Forge
 *
 * Coordinates the full pipeline: plan → execute → verify → merge
 */

import type {
  Task,
  TaskGraph,
  ProofArtifact,
  EvidenceLedger,
  EvidenceEntry,
  StateCheckpoint,
  ForgeConfig,
} from './types.js';
import { OrchestratorError } from './errors.js';
import type { GitPort } from '../ports/git.js';
import type { StatePort } from '../ports/state.js';
import type { VerifierPort } from '../ports/verifier.js';
import type { PlannerPort } from '../ports/planner.js';
import type { Logger } from '../utils/logger.js';
import { generateId, formatDate, slugify } from '../utils/helpers.js';

export interface OrchestratorDeps {
  readonly config: ForgeConfig;
  readonly git: GitPort;
  readonly state: StatePort;
  readonly verifier: VerifierPort;
  readonly planner: PlannerPort;
  readonly logger: Logger;
}

export class ForgeOrchestrator {
  private readonly config: ForgeConfig;
  private readonly git: GitPort;
  private readonly state: StatePort;
  private readonly verifier: VerifierPort;
  private readonly planner: PlannerPort;
  private readonly logger: Logger;
  private currentGoalId?: string;
  private currentSessionId: string;

  constructor(deps: OrchestratorDeps) {
    this.config = deps.config;
    this.git = deps.git;
    this.state = deps.state;
    this.verifier = deps.verifier;
    this.planner = deps.planner;
    this.logger = deps.logger;
    this.currentSessionId = generateId('session');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  async executeGoal(goal: string, context?: string): Promise<EvidenceLedger> {
    const goalId = this.goalIdFromText(goal);
    this.currentGoalId = goalId;

    this.logger.info('Starting goal execution', { goalId, goal });

    // 1. Decompose
    const graph = await this.planner.decompose({
      goal,
      context,
      constraints: {
        max_depth: this.config.core.escalation.max_escalation_depth,
        approval_mode: 'confirm',
      },
    });

    // Override goal_id to match our generated one
    (graph as { goal_id: string }).goal_id = goalId;
    this.currentGoalId = goalId;

    await this.state.saveTaskGraph(goalId, graph);
    this.logger.info('Task graph created', { goalId, tasks: graph.tasks.length });

    // 2. Create evidence ledger
    const ledger = await this.state.createEvidenceLedger(goalId);
    this.appendEntry(ledger, 'goal_intake', goal);
    this.appendEntry(ledger, 'plan_created', `Created task graph with ${graph.tasks.length} tasks`, { taskIds: graph.tasks.map((t) => t.id) });

    // 3. Execute tasks in dependency order
    const completedTasks = new Set<string>();
    const failedTasks = new Set<string>();

    while (completedTasks.size + failedTasks.size < graph.tasks.length) {
      const ready = this.getReadyTasks(graph, completedTasks, failedTasks);
      if (ready.length === 0) {
        if (failedTasks.size > 0) {
          this.logger.warn('Deadlock detected: tasks blocked by failures', { failedTasks: Array.from(failedTasks) });
          break;
        }
        throw new OrchestratorError('Task graph deadlock: no ready tasks but incomplete', 'DEADLOCK');
      }

      for (const task of ready) {
        const result = await this.executeTask(task, graph, ledger);
        if (result) {
          completedTasks.add(task.id);
        } else {
          failedTasks.add(task.id);
          // Stop if this task is critical (no downstream should run)
          if (task.level <= 1) {
            this.logger.error('Critical task failed, aborting goal', { taskId: task.id });
            break;
          }
        }
      }

      if (failedTasks.size > 0 && ready.some((t) => t.level <= 1 && failedTasks.has(t.id))) {
        break;
      }
    }

    // 4. Merge successful tasks
    if (completedTasks.size > 0) {
      await this.mergeCompletedTasks(graph, Array.from(completedTasks), ledger);
    }

    // 5. Finalize ledger
    (ledger as { summary: EvidenceLedger['summary'] }).summary = {
      total_entries: ledger.entries.length,
      tasks_completed: completedTasks.size,
      tasks_failed: failedTasks.size,
      total_duration_seconds: 0,
      final_status: failedTasks.size === 0 ? 'success' : failedTasks.size === graph.tasks.length ? 'failure' : 'partial',
    };

    await this.state.saveCheckpoint(await this.buildCheckpoint(graph, ledger));
    this.logger.info('Goal execution complete', { goalId, completed: completedTasks.size, failed: failedTasks.size });

    return ledger;
  }

  async runTask(taskId: string, graph: TaskGraph): Promise<ProofArtifact | undefined> {
    const task = graph.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new OrchestratorError(`Task not found: ${taskId}`, 'TASK_NOT_FOUND');
    }
    return this.executeTaskInternal(task, graph);
  }

  async writeCheckpoint(): Promise<StateCheckpoint> {
    if (!this.currentGoalId) {
      throw new OrchestratorError('No active goal', 'NO_ACTIVE_GOAL');
    }
    const graph = await this.state.loadTaskGraph(this.currentGoalId);
    const ledger = await this.state.loadEvidenceLedger(this.currentGoalId);
    if (!graph || !ledger) {
      throw new OrchestratorError('Missing state for checkpoint', 'STATE_MISSING');
    }
    const checkpoint = await this.buildCheckpoint(graph, ledger);
    await this.state.saveCheckpoint(checkpoint);
    this.logger.info('Checkpoint written', { checkpointId: checkpoint.checkpoint_id });
    return checkpoint;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Task Execution
  // ──────────────────────────────────────────────────────────────────────────

  private async executeTask(
    task: Task,
    graph: TaskGraph,
    ledger: EvidenceLedger
  ): Promise<boolean> {
    this.logger.info('Executing task', { taskId: task.id, title: task.title, level: task.level });
    this.appendEntry(ledger, 'task_started', task.title, undefined, task.id);

    try {
      const artifact = await this.executeTaskInternal(task, graph);
      if (artifact) {
        this.appendEntry(ledger, 'task_completed', `Task completed with score ${artifact.summary?.duration_seconds ?? 0}s`, undefined, task.id, [artifact.artifact_id]);
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Task failed', { taskId: task.id, error: message });
      this.appendEntry(ledger, 'task_failed', message, undefined, task.id);
      return false;
    }
  }

  private async executeTaskInternal(task: Task, _graph: TaskGraph): Promise<ProofArtifact | undefined> {
    if (!this.currentGoalId) {
      throw new OrchestratorError('No active goal', 'NO_ACTIVE_GOAL');
    }

    // 1. Create worktree
    const branchName = this.config.git.task_branch_template
      .replace('{task_id}', task.id)
      .replace('{slug}', slugify(task.title));

    const worktreePath = `${this.config.git.worktree_base}${this.currentGoalId}/${task.id}`;
    const baseBranch = await this.git.currentBranch();

    const worktree = await this.git.createWorktree(worktreePath, branchName, baseBranch);
    task.worktree = worktree.path;
    task.branch = worktree.branch;
    task.started_at = formatDate();

    // 2. Run gates
    const gateResults = await this.verifier.runAllGates(worktree.path);
    const allRequiredPass = gateResults.every(
      (g) =>
        !task.proof_requirements.find((pr) => pr.gate === g.gate && pr.required) ||
        g.status === 'pass' ||
        g.status === 'warn'
    );

    // 3. Build proof artifact
    const artifact: ProofArtifact = {
      artifact_id: generateId('proof'),
      task_id: task.id,
      goal_id: this.currentGoalId,
      version: '1.0.0',
      timestamp: formatDate(),
      agent_role: 'coder',
      worktree: worktree.path,
      claims: gateResults.map((g) => ({
        gate: g.gate,
        status: g.status,
        command: g.command,
        exit_code: g.exit_code,
        output_excerpt: g.output.substring(0, 500),
        timestamp: formatDate(),
        verifier: 'mechanical',
      })),
      summary: {
        files_changed: 0,
        lines_added: 0,
        lines_removed: 0,
        tests_added: 0,
        duration_seconds: Math.round(gateResults.reduce((sum, g) => sum + g.duration_ms, 0) / 1000),
      },
    };

    await this.state.saveProofArtifact(this.currentGoalId, artifact);

    // 4. Risk score
    const risk = await this.verifier.scoreRisk(worktree.path);
    this.logger.info('Task gates complete', {
      taskId: task.id,
      allPass: allRequiredPass,
      riskScore: risk.score,
      decision: risk.decision,
    });

    if (!allRequiredPass || risk.decision === 'auto_deny') {
      // Clean up worktree on failure
      if (this.config.git.auto_clean_worktrees) {
        await this.git.destroyWorktree(worktree.path, !this.config.git.retain_failed_branches);
      }
      return undefined;
    }

    task.status = 'completed';
    task.completed_at = formatDate();
    task.evidence_id = artifact.artifact_id;

    return artifact;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Merge
  // ──────────────────────────────────────────────────────────────────────────

  private async mergeCompletedTasks(
    graph: TaskGraph,
    completedIds: string[],
    ledger: EvidenceLedger
  ): Promise<void> {
    if (!this.currentGoalId) return;

    const sessionBranch = this.config.git.session_branch_template
      .replace('{date}', new Date().toISOString().split('T')[0])
      .replace('{goal_slug}', slugify(graph.goal_id.split('-').slice(0, -1).join('-')));

    // Create session branch from main
    const baseBranch = await this.git.currentBranch();
    await this.git.createBranch(sessionBranch, baseBranch);

    for (const taskId of completedIds) {
      const task = graph.tasks.find((t) => t.id === taskId);
      if (!task?.branch) continue;

      try {
        const result = await this.git.merge(sessionBranch, task.branch, 'rebase');
        if (result.success) {
          this.appendEntry(ledger, 'merge', `Merged ${task.branch} into ${sessionBranch}`, undefined, taskId);
        } else {
          this.logger.warn('Merge had conflicts', { taskId, conflicts: result.conflicts });
          await this.git.abortMerge(sessionBranch);
          this.appendEntry(ledger, 'rollback', `Aborted merge of ${task.branch} due to conflicts`, undefined, taskId);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('Merge failed', { taskId, error: message });
        this.appendEntry(ledger, 'rollback', `Merge failed: ${message}`, undefined, taskId);
      }
    }

    this.logger.info('Merge phase complete', { sessionBranch, merged: completedIds.length });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private getReadyTasks(
    graph: TaskGraph,
    completed: Set<string>,
    failed: Set<string>
  ): Task[] {
    return graph.tasks.filter((task) => {
      if (completed.has(task.id) || failed.has(task.id) || task.status === 'running') {
        return false;
      }
      const dependencies = graph.edges
        .filter((e) => e.to === task.id && e.type === 'depends_on')
        .map((e) => e.from);
      return dependencies.every((dep) => completed.has(dep));
    });
  }

  private appendEntry(
    ledger: EvidenceLedger,
    type: EvidenceEntry['type'],
    description: string,
    data?: Record<string, unknown>,
    taskId?: string,
    artifactRefs?: string[]
  ): void {
    const entry: EvidenceEntry = {
      seq: ledger.entries.length,
      timestamp: formatDate(),
      type,
      description,
      task_id: taskId,
      data,
      artifact_refs: artifactRefs,
    };
    ledger.entries.push(entry);
  }

  private goalIdFromText(text: string): string {
    return `${slugify(text)}-${Date.now().toString(36)}`;
  }

  private async buildCheckpoint(graph: TaskGraph, ledger: EvidenceLedger): Promise<StateCheckpoint> {
    const worktrees = graph.tasks
      .filter((t) => t.worktree)
      .map((t) => ({
        task_id: t.id,
        path: t.worktree!,
        branch: t.branch!,
        dirty: false,
      }));

    return {
      checkpoint_id: generateId('chk'),
      goal_id: graph.goal_id,
      timestamp: formatDate(),
      session_id: this.currentSessionId,
      task_graph: {
        path: `.pi/state/task-graphs/${graph.goal_id}.json`,
        hash: 'sha256-placeholder',
      },
      evidence_ledger: {
        path: `.pi/state/evidence/${graph.goal_id}/ledger.json`,
        last_seq: ledger.entries.length - 1,
      },
      active_worktrees: worktrees,
      pending_decisions: [],
    };
  }
}
