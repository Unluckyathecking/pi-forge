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
  FailedTaskMarker,
} from './types.js';
import { OrchestratorError } from './errors.js';
import { createHash } from 'node:crypto';
import { join as joinPath } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { GitPort, WorktreeInfo } from '../ports/git.js';
import type { StatePort } from '../ports/state.js';
import type { VerifierPort, GateResult } from '../ports/verifier.js';
import type { PlannerPort } from '../ports/planner.js';
import type { WorkerPort } from '../ports/worker.js';
import type { Logger } from '../utils/logger.js';
import { generateId, formatDate, slugify } from '../utils/helpers.js';

export interface OrchestratorDeps {
  readonly config: ForgeConfig;
  readonly git: GitPort;
  readonly state: StatePort;
  readonly verifier: VerifierPort;
  readonly planner: PlannerPort;
  readonly worker?: WorkerPort;
  readonly logger: Logger;
}

export class ForgeOrchestrator {
  private readonly config: ForgeConfig;
  private readonly git: GitPort;
  private readonly state: StatePort;
  private readonly verifier: VerifierPort;
  private readonly planner: PlannerPort;
  private readonly worker?: WorkerPort;
  private readonly logger: Logger;
  private currentGoalId?: string;
  private currentGoalSlug?: string;
  private currentSessionId: string;

  constructor(deps: OrchestratorDeps) {
    this.config = deps.config;
    this.git = deps.git;
    this.state = deps.state;
    this.verifier = deps.verifier;
    this.planner = deps.planner;
    this.worker = deps.worker;
    this.logger = deps.logger;
    this.currentSessionId = generateId('session');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  async executeGoal(
    goal: string,
    context?: string,
    signal?: AbortSignal,
    options?: { tasks?: readonly string[]; projectRoot?: string },
  ): Promise<EvidenceLedger> {
    const goalSlug = slugify(goal);
    const goalId = this.goalIdFromText(goal);
    this.currentGoalId = goalId;
    this.currentGoalSlug = goalSlug;

    this.logger.info('Starting goal execution', { goalId, goal });
    if (isAborted(signal)) {
      throw new OrchestratorError('Goal execution aborted before start', 'ABORTED');
    }

    // 1. Decompose. The orchestrator owns goal_id, not the planner: we want
    // every artifact under this run to share one stable identifier, so we
    // replace the planner's transient goal_id with a copy that uses ours.
    const rawGraph = await this.planner.decompose({
      goal,
      context,
      constraints: {
        max_depth: this.config.core.escalation.max_escalation_depth,
        approval_mode: 'confirm',
      },
      tasks: options?.tasks,
      projectRoot: options?.projectRoot ?? process.cwd(),
    });
    const graph: TaskGraph = { ...rawGraph, goal_id: goalId };

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
        if (isAborted(signal)) {
          this.logger.warn('Goal aborted mid-batch by caller signal', { taskId: task.id });
          failedTasks.add(task.id);
          this.appendEntry(ledger, 'task_failed', 'Aborted by caller signal', undefined, task.id);
          break;
        }
        const result = await this.executeTask(task, graph, ledger, signal);
        if (result) {
          completedTasks.add(task.id);
        } else {
          failedTasks.add(task.id);
          // Stop if this task is critical (no downstream should run)
          if (task.level <= 1) {
            const lastFailure = [...ledger.entries].reverse().find(
              (e) => e.type === 'task_failed' && e.task_id === task.id
            );
            this.logger.error('Critical task failed, aborting goal', {
              taskId: task.id,
              title: task.title,
              level: task.level,
              reason: lastFailure?.description ?? 'unknown',
            });
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
    ledger.summary = {
      total_entries: ledger.entries.length,
      tasks_completed: completedTasks.size,
      tasks_failed: failedTasks.size,
      total_duration_seconds: 0,
      final_status: failedTasks.size === 0 ? 'success' : failedTasks.size === graph.tasks.length ? 'failure' : 'partial',
    };
    ledger.closed_at = formatDate();

    // Flush the in-memory ledger to disk so subsequent writeCheckpoint() or
    // status queries see the actual entries instead of the empty skeleton
    // written by createEvidenceLedger.
    await this.state.saveEvidenceLedger(goalId, ledger);
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
    ledger: EvidenceLedger,
    signal?: AbortSignal
  ): Promise<boolean> {
    this.logger.info('Executing task', { taskId: task.id, title: task.title, level: task.level });
    this.appendEntry(ledger, 'task_started', task.title, undefined, task.id);

    try {
      const artifact = await this.executeTaskInternal(task, graph, signal);
      if (artifact) {
        this.appendEntry(ledger, 'task_completed', `Task completed with score ${artifact.summary?.duration_seconds ?? 0}s`, undefined, task.id, [artifact.artifact_id]);
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Task failed', { taskId: task.id, error: message });
      const data: Record<string, unknown> = {};
      if (err instanceof OrchestratorError) {
        data.error_code = err.code;
        if (err.context !== undefined) {
          Object.assign(data, err.context);
        }
      }
      this.appendEntry(
        ledger,
        'task_failed',
        message,
        Object.keys(data).length > 0 ? data : undefined,
        task.id
      );
      return false;
    }
  }

  private async executeTaskInternal(task: Task, _graph: TaskGraph, signal?: AbortSignal): Promise<ProofArtifact | undefined> {
    if (!this.currentGoalId) {
      throw new OrchestratorError('No active goal', 'NO_ACTIVE_GOAL');
    }

    // 1. Create worktree
    const branchName = this.config.git.task_branch_template
      .replace('{task_id}', task.id)
      .replace('{taskId}', task.id)
      .replace('{slug}', slugify(task.title));

    // Use path.join so trailing slashes in worktree_base are handled correctly
    // (the embedded default omits the slash; user config.yaml usually has it).
    const worktreePath = joinPath(this.config.git.worktree_base, this.currentGoalId, task.id);
    const baseBranch = await this.git.currentBranch();

    task.status = 'running';
    const worktree = await this.git.createWorktree(worktreePath, branchName, baseBranch);
    task.worktree = worktree.path;
    task.branch = worktree.branch;
    task.started_at = formatDate();

    // 2. Execute coding work in the worktree
    let workerResult: { filesChanged: number; linesAdded: number; linesRemoved: number } = { filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
    if (this.worker) {
      this.logger.info('Running worker in worktree', { taskId: task.id, worktree: worktree.path });
      try {
        const result = await this.worker.execute(task, worktree.path, signal);
        workerResult = {
          filesChanged: result.filesChanged,
          linesAdded: result.linesAdded,
          linesRemoved: result.linesRemoved,
        };
        if (!result.success) {
          this.logger.warn('Worker reported failure', { taskId: task.id, error: result.error });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('Worker execution failed', { taskId: task.id, error: message });
        if (this.config.git.auto_clean_worktrees) {
          await this.git.destroyWorktree(worktree.path, !this.config.git.retain_failed_branches);
        }
        throw new OrchestratorError(`Worker failed for task ${task.id}: ${message}`, 'WORKER_FAILED');
      }
    } else {
      this.logger.info('No worker configured; skipping code generation', { taskId: task.id });
    }

    // 3. Run gates
    const gateResults = await this.verifier.runAllGates(worktree.path);
    const allRequiredPass = gateResults.every(
      (g) =>
        !task.proof_requirements.find((pr) => pr.gate === g.gate && pr.required) ||
        g.status === 'pass' ||
        g.status === 'warn'
    );

    // 4. Build proof artifact. The `all_pass` and `failed_gates`
    //    fields make the artifact self-describing — operators can
    //    grep proofs/ for failures without re-deriving the predicate.
    const failedGates = gateResults
      .filter((g) => g.status === 'fail')
      .map((g) => g.gate);
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
        output_excerpt: g.output.substring(0, this.config.proof_carrying.artifact.max_output_excerpt_length),
        timestamp: formatDate(),
        verifier: 'mechanical',
      })),
      all_pass: allRequiredPass,
      failed_gates: failedGates,
      summary: {
        files_changed: workerResult.filesChanged,
        lines_added: workerResult.linesAdded,
        lines_removed: workerResult.linesRemoved,
        tests_added: 0,
        duration_seconds: Math.round(gateResults.reduce((sum, g) => sum + g.duration_ms, 0) / 1000),
      },
    };

    // 4. Risk score (before persisting the artifact so the commit step
    //    can also enrich the persisted record).
    const risk = await this.verifier.scoreRisk(worktree.path);
    this.logger.info('Task gates complete', {
      taskId: task.id,
      allPass: allRequiredPass,
      riskScore: risk.score,
      decision: risk.decision,
    });

    if (!allRequiredPass || risk.decision === 'auto_deny') {
      const failedGates = gateResults.filter((g) => g.status === 'fail');
      const failureReason =
        failedGates.length > 0
          ? `Required gate(s) failed: ${failedGates.map((g) => g.gate).join(', ')}`
          : `Risk gate auto_deny (score ${risk.score})`;
      const firstErrorLine =
        failedGates[0]?.output.split('\n').find((l) => l.trim().length > 0) ?? '';

      this.logger.error('Task failure detected', {
        taskId: task.id,
        failed_gates: failedGates.map((g) => g.gate),
        first_error_line: firstErrorLine.substring(0, 200),
        risk_score: risk.score,
        risk_decision: risk.decision,
      });

      // Persist the artifact BEFORE deciding whether to clean up the
      // worktree. The pre-fix orchestrator built the artifact and then
      // threw it away — operators were left with an empty proofs/
      // directory and no record of which gate failed. Save it first
      // so failure diagnostics survive even if cleanup later throws.
      await this.state.saveProofArtifact(this.currentGoalId, artifact);

      // === Cleanup / preservation decision (Phase 2) ===
      // preserve_worktree_on_failure: true is shorthand for failed_task_behavior: 'preserve'
      const effectiveBehavior: ForgeConfig['git']['failed_task_behavior'] =
        this.config.git.preserve_worktree_on_failure ? 'preserve' : this.config.git.failed_task_behavior;

      if (effectiveBehavior === 'preserve' || effectiveBehavior === 'tag-and-purge') {
        await this.preserveFailedTask({
          task,
          worktree,
          artifact,
          gateResults,
          failedGates,
          effectiveBehavior,
        });
      } else {
        // 'purge' — legacy default, unchanged behaviour
        if (this.config.git.auto_clean_worktrees) {
          await this.git.destroyWorktree(worktree.path, !this.config.git.retain_failed_branches);
        }
      }

      // Throw instead of returning undefined so executeTask catches it and
      // writes an enriched task_failed ledger entry. Previously, returning
      // undefined left the ledger silent on gate failures.
      throw new OrchestratorError(failureReason, 'GATES_FAILED', {
        failed_gates: failedGates.map((g) => g.gate),
        first_error_line: firstErrorLine.substring(0, 200),
        risk_score: risk.score,
        risk_decision: risk.decision,
      });
    }

    // 5. Commit the worker's edits so the merge step has something to
    //    rebase. The worker writes files into the worktree but never
    //    commits — without this step, `gates pass + merge succeeds`
    //    would leave the session branch with zero of the worker's code.
    const commitMessage = `forge: ${task.title} (task ${task.id})`;
    let commitSha: string;
    try {
      commitSha = await this.git.commit(worktree.path, commitMessage, { all: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Failed to commit worker output', {
        taskId: task.id,
        worktree: worktree.path,
        error: message,
      });
      // Throw so the outer executeTask catches it and writes a
      // task_failed ledger entry. Returning undefined here would mark
      // the task as failed in-memory but leave the ledger silent.
      throw new OrchestratorError(
        `Worker output could not be committed: ${message}`,
        'COMMIT_FAILED'
      );
    }

    // 6. Re-stat the diff so the artifact reflects what the commit
    //    actually added. The worker's `git diff HEAD --stat` ran
    //    pre-commit on a fresh worktree and ignored untracked files
    //    (so it always reported 0). Now that the task commit exists,
    //    diff it against the orchestrator's base branch.
    try {
      const commitDiff = await this.git.diffSinceBranch(worktree.path, baseBranch);
      (artifact as { summary?: ProofArtifact['summary'] }).summary = {
        files_changed: commitDiff.files,
        lines_added: commitDiff.additions,
        lines_removed: commitDiff.deletions,
        tests_added: 0,
        duration_seconds: artifact.summary?.duration_seconds ?? 0,
      };
    } catch {
      // Keep the worker's earlier estimate.
    }
    (artifact as { commit_sha?: string }).commit_sha = commitSha;

    // 7. Persist the finalized artifact (commit_sha + accurate diff
    //    stats included).
    await this.state.saveProofArtifact(this.currentGoalId, artifact);

    task.status = 'completed';
    task.completed_at = formatDate();
    task.evidence_id = artifact.artifact_id;

    return artifact;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Failure Preservation (Phase 2)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute the 6-step failed-task preservation flow when
   * git.failed_task_behavior is 'preserve' or 'tag-and-purge'.
   *
   * Each step is wrapped so a failure in one (e.g. updateRef on a stale ref)
   * doesn't abort the others — preservation is best-effort by design.
   *
   *   1. Commit dirty worker state with `wip(<task>): preserved on <gate> failure`
   *   2. Tag the SHA at refs/forge/failed/<goal>/<task> so it survives branch deletion
   *   3. preserve → moveWorktree to <path><suffix> | tag-and-purge → destroyWorktree
   *   4. Build + save FailedTaskMarker to the central index
   *   5. Write in-tree .pi-failed.json sidecar inside the preserved worktree
   *   6. Emit operator-facing 'Task failure preserved' log
   */
  private async preserveFailedTask(args: {
    task: Task;
    worktree: WorktreeInfo;
    artifact: ProofArtifact;
    gateResults: GateResult[];
    failedGates: GateResult[];
    effectiveBehavior: 'preserve' | 'tag-and-purge';
  }): Promise<void> {
    const { task, worktree, artifact, gateResults, failedGates, effectiveBehavior } = args;
    if (!this.currentGoalId) {
      throw new OrchestratorError('No active goal during preservation', 'NO_ACTIVE_GOAL');
    }

    // 1. Commit dirty state. git.commit already handles "nothing to commit" gracefully
    //    (returns HEAD sha when there's nothing to stage). Catch failures so
    //    preservation can still proceed with whatever we have.
    const wipReason = failedGates.length > 0
      ? failedGates.map((g) => g.gate).join(',')
      : 'risk_auto_deny';
    const wipMsg = `wip(${task.id}): preserved on ${wipReason} failure`;
    let commitSha = '';
    let wipWasEmpty = false;
    try {
      const wasDirty = await this.git.isDirty(worktree.path);
      commitSha = await this.git.commit(worktree.path, wipMsg, { all: true });
      wipWasEmpty = !wasDirty;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('preserveFailedTask: commit failed; continuing without SHA', {
        taskId: task.id, error: message,
      });
    }

    // 2. Tag the SHA at refs/forge/failed/<goal>/<task> so it survives branch deletion.
    const tagRef = `refs/forge/failed/${this.currentGoalId}/${task.id}`;
    if (commitSha !== '') {
      try {
        await this.git.updateRef(tagRef, commitSha);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn('preserveFailedTask: updateRef failed; tag not created', {
          taskId: task.id, tagRef, error: message,
        });
      }
    }

    // 3. Decide preserve (rename) vs tag-and-purge (destroy).
    let preservedPath: string | undefined;
    if (effectiveBehavior === 'preserve') {
      const target = `${worktree.path}${this.config.git.failed_worktree_suffix}`;
      try {
        preservedPath = await this.git.moveWorktree(worktree.path, target);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn('preserveFailedTask: moveWorktree failed; leaving worktree in place', {
          taskId: task.id, target, error: message,
        });
        preservedPath = worktree.path;
      }
    } else {
      // tag-and-purge — destroy the worktree, the tag preserves the SHA.
      if (this.config.git.auto_clean_worktrees) {
        try {
          await this.git.destroyWorktree(worktree.path, !this.config.git.retain_failed_branches);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn('preserveFailedTask: destroyWorktree failed during tag-and-purge', {
            taskId: task.id, error: message,
          });
        }
      }
    }

    // 4. Build + save the FailedTaskMarker (central index).
    const marker: FailedTaskMarker = {
      task_id: task.id,
      goal_id: this.currentGoalId,
      failed_at: formatDate(),
      failure_kind: 'gate_failure',
      branch: task.branch ?? worktree.branch,
      tag_ref: tagRef,
      commit_sha: commitSha,
      wip_commit_was_empty: wipWasEmpty,
      worktree_path: preservedPath,
      gates: gateResults.map((g) => ({
        name: g.gate,
        status: g.status,
        exit_code: g.exit_code,
        stderr_first_line: g.output.split('\n').find((l) => l.trim().length > 0)?.substring(0, 200),
      })),
      files_modified: [],   // populated below if we can diff
      lines_added: artifact.summary?.lines_added ?? 0,
      lines_removed: artifact.summary?.lines_removed ?? 0,
      recovery_hint: preservedPath
        ? `cd ${preservedPath} && git status; jq '.gates' .pi-failed.json`
        : `git checkout ${tagRef}  # then inspect`,
      operator_commands: {
        inspect: `pi-forge inspect ${task.id}`,
        salvage: `pi-forge salvage ${task.id} --to-branch <name>`,
        retry: `pi-forge retry ${task.id}`,
        purge: `pi-forge cleanup --task ${task.id}`,
      },
    };
    try {
      await this.state.saveFailedMarker(marker);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('preserveFailedTask: saveFailedMarker failed', { taskId: task.id, error: message });
    }

    // 5. Write in-tree .pi-failed.json sidecar inside the preserved worktree.
    //    Best-effort: failure here is logged but not fatal.
    if (preservedPath !== undefined) {
      try {
        await writeFile(joinPath(preservedPath, '.pi-failed.json'), JSON.stringify(marker, null, 2), 'utf-8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn('preserveFailedTask: sidecar write failed', { taskId: task.id, error: message });
      }

      // Drop tooling-ignore markers so parent-project eslint/tsc/etc don't
      // recurse into this preserved worktree. Best-effort: warn but don't
      // abort if either write fails (the preserved worktree is still usable
      // via `pi-forge inspect`/`salvage`).
      for (const [filename, content] of [
        ['.eslintignore', '*\n'],
        ['.gitignore', '*\n'],
      ] as const) {
        try {
          await writeFile(joinPath(preservedPath, filename), content, 'utf-8');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn('preserveFailedTask: tooling-isolation marker write failed', {
            taskId: task.id, filename, error: message,
          });
        }
      }
    }

    // 6. Operator-facing summary log.
    this.logger.error('Task failure preserved', {
      taskId: task.id,
      behavior: effectiveBehavior,
      worktree: preservedPath,
      branch: task.branch ?? worktree.branch,
      tag_ref: tagRef,
      sha: commitSha !== '' ? commitSha.substring(0, 8) : undefined,
      inspect: marker.operator_commands.inspect,
      salvage: marker.operator_commands.salvage,
    });
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

    const goalSlug = this.currentGoalSlug ?? slugify(graph.goal_id);
    const sessionBranch = this.config.git.session_branch_template
      .replace('{date}', new Date().toISOString().split('T')[0])
      .replace('{goal_slug}', goalSlug)
      .replace('{goal_id}', graph.goal_id)
      .replace('{goalId}', graph.goal_id)
      .replace('{sessionId}', this.currentSessionId)
      .replace('{session_id}', this.currentSessionId);

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
    // ⚡ Bolt Optimization:
    // Replaced O(V * E) filter lookup with an O(E) map pre-computation to speed up finding tasks.
    // This reduces the complexity to O(V + E) for each call, significantly improving execution
    // time for task graphs with many dependencies.
    const dependencyMap = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (edge.type === 'depends_on') {
        const deps = dependencyMap.get(edge.to);
        if (deps) {
          deps.push(edge.from);
        } else {
          dependencyMap.set(edge.to, [edge.from]);
        }
      }
    }

    return graph.tasks.filter((task) => {
      if (completed.has(task.id) || failed.has(task.id) || task.status === 'running') {
        return false;
      }
      const dependencies = dependencyMap.get(task.id) ?? [];
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
    const candidates = graph.tasks.filter(
      (t): t is Task & { worktree: string; branch: string } =>
        typeof t.worktree === 'string' && typeof t.branch === 'string'
    );
    const worktrees = await Promise.all(
      candidates.map(async (t) => {
        const dirty = await this.safeIsDirty(t.worktree);
        return {
          task_id: t.id,
          path: t.worktree,
          branch: t.branch,
          dirty,
        };
      })
    );

    const taskGraphHash = sha256Json(graph);

    return {
      checkpoint_id: generateId('chk'),
      goal_id: graph.goal_id,
      timestamp: formatDate(),
      session_id: this.currentSessionId,
      task_graph: {
        path: `.pi/state/task-graphs/${graph.goal_id}.json`,
        hash: `sha256:${taskGraphHash}`,
      },
      evidence_ledger: {
        path: `.pi/state/evidence/${graph.goal_id}/ledger.json`,
        last_seq: Math.max(ledger.entries.length - 1, 0),
      },
      active_worktrees: worktrees,
      pending_decisions: [],
    };
  }

  private async safeIsDirty(worktreePath: string): Promise<boolean> {
    try {
      return await this.git.isDirty(worktreePath);
    } catch (err) {
      this.logger.warn('isDirty probe failed; assuming clean', {
        worktree: worktreePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted);
}
