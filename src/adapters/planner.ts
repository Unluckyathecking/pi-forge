/**
 * SimplePlannerAdapter — Rule-based task decomposition
 *
 * A lightweight planner that decomposes goals without external LLM calls.
 * Suitable for MVP and deterministic testing.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';

import type {
  TaskGraph,
  Task,
  TaskLevel,
  TaskStatus,
  ProofRequirement,
  EdgeType,
} from '../core/types.js';
import type { PlannerPort, DecompositionRequest, ContractSet } from '../ports/planner.js';

export class SimplePlannerAdapter implements PlannerPort {
  readonly name = 'simple-planner';

  async decompose(request: DecompositionRequest): Promise<TaskGraph> {
    const goalId = this.goalIdFromText(request.goal);
    const projectRoot = request.projectRoot ?? process.cwd();
    const planMdDetected = this.detectPlanMd(request.goal, projectRoot);
    let tasks = this.buildTasks(
      request.goal,
      request.constraints?.max_depth ?? 3,
      planMdDetected,
    );

    // --tasks override: filter to the allowlist, preserving the order the
    // planner decomposed them in. Empty array = no filtering (use full set).
    if (request.tasks && request.tasks.length > 0) {
      const allowlist = new Set(request.tasks);
      tasks = tasks.filter((t) => allowlist.has(t.id));
    }

    const edges = this.buildEdges(tasks);

    return {
      goal_id: goalId,
      version: '1.0.0',
      created_at: new Date().toISOString(),
      tasks,
      edges,
      constraints: {
        max_depth: request.constraints?.max_depth ?? 3,
        time_budget_minutes: request.constraints?.time_budget_minutes,
        approval_mode: request.constraints?.approval_mode ?? 'confirm',
      },
    };
  }

  async refineGraph(graph: TaskGraph, feedback: string): Promise<TaskGraph> {
    // Simple refinement: add a follow-up task for feedback
    const followUpId = `feedback-${graph.tasks.length + 1}`;
    const followUp: Task = {
      id: followUpId,
      level: 2,
      title: `Address feedback: ${feedback.substring(0, 40)}`,
      description: feedback,
      status: 'pending' as TaskStatus,
      proof_requirements: await this.generateProofRequirements({
        id: followUpId,
        level: 2,
        title: 'feedback',
        status: 'pending',
        proof_requirements: [],
        input_contracts: [],
        output_contracts: [],
        estimated_minutes: 30,
      }),
      input_contracts: [],
      output_contracts: [],
      estimated_minutes: 30,
    };

    return {
      ...graph,
      tasks: [...graph.tasks, followUp],
      edges: [
        ...graph.edges,
        ...(graph.tasks.length > 0
          ? [
              {
                from: graph.tasks[graph.tasks.length - 1].id,
                to: followUpId,
                type: 'depends_on' as EdgeType,
              },
            ]
          : []),
      ],
    };
  }

  async generateProofRequirements(task: Task): Promise<ProofRequirement[]> {
    const base: ProofRequirement[] = [
      { gate: 'lint', required: true },
      { gate: 'typecheck', required: true },
      { gate: 'test', required: true },
    ];

    if (task.level <= 1) {
      base.push({ gate: 'build', required: true });
      base.push({ gate: 'security_scan', required: true });
    }

    if (task.level <= 2) {
      base.push({ gate: 'contract_verify', required: false });
    }

    return base;
  }

  async draftContracts(_task: Task): Promise<ContractSet> {
    return {
      type_contracts: [],
      api_contracts: [],
      behavior_contracts: [],
      security_contracts: [],
    };
  }

  async estimateEffort(task: Task): Promise<number> {
    const baseMinutes: Record<TaskLevel, number> = {
      0: 480,
      1: 120,
      2: 45,
      3: 15,
    };

    const complexity = task.description?.length ?? 0;
    const multiplier = 1 + Math.min(complexity / 500, 1);
    return Math.round(baseMinutes[task.level] * multiplier);
  }

  async health(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true };
  }

  // ── Private helpers ──

  private goalIdFromText(text: string): string {
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 30);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    return `${slug}-${ts}`;
  }

  private detectPlanMd(goal: string, projectRoot: string): boolean {
    if (!/PLAN\.md/i.test(goal)) return false;
    try {
      statSync(join(projectRoot, 'PLAN.md'));
      return true;
    } catch {
      return false;
    }
  }

  private buildTasks(goal: string, maxDepth: number, planMdDetected: boolean): Task[] {
    const lower = goal.toLowerCase();
    const isRefactor = lower.includes('refactor');
    const isFix = lower.includes('fix') || lower.includes('bug');
    const isFeature = !isRefactor && !isFix;

    const tasks: Task[] = [];

    if (maxDepth >= 1 && isFeature) {
      if (planMdDetected) {
        // Skip the redundant plan task — PLAN.md IS the plan.
        tasks.push(this.makeTask('implement', 1, 'Implement per PLAN.md', goal, ['lint', 'typecheck', 'test', 'build']));
        tasks.push(this.makeTask('verify', 1, 'Verify gates + write demo checklist', goal, ['lint', 'typecheck', 'test']));
      } else {
        tasks.push(this.makeTask('plan', 1, 'Plan architecture and contracts', goal, ['lint', 'typecheck']));
        tasks.push(this.makeTask('implement', 1, 'Implement feature', goal, ['lint', 'typecheck', 'test', 'build']));
        tasks.push(this.makeTask('test', 1, 'Write integration tests', goal, ['lint', 'typecheck', 'test']));
      }
    } else if (maxDepth >= 1 && isFix) {
      tasks.push(this.makeTask('reproduce', 2, 'Reproduce bug', goal, ['test']));
      tasks.push(this.makeTask('fix', 2, 'Apply fix', goal, ['lint', 'typecheck', 'test']));
    } else if (maxDepth >= 1 && isRefactor) {
      tasks.push(this.makeTask('refactor', 2, 'Refactor code', goal, ['lint', 'typecheck', 'test']));
    } else {
      tasks.push(this.makeTask('task-1', 3, goal, goal, ['lint', 'typecheck', 'test']));
    }

    return tasks;
  }

  private makeTask(
    id: string,
    level: TaskLevel,
    title: string,
    description: string,
    gates: string[]
  ): Task {
    return {
      id,
      level,
      title,
      description,
      status: 'pending',
      proof_requirements: gates.map((g) => ({ gate: g as ProofRequirement['gate'], required: true })),
      input_contracts: [],
      output_contracts: [],
      estimated_minutes: [480, 120, 45, 15][level],
    };
  }

  private buildEdges(tasks: Task[]): { from: string; to: string; type: EdgeType }[] {
    const edges: { from: string; to: string; type: EdgeType }[] = [];
    for (let i = 1; i < tasks.length; i++) {
      edges.push({ from: tasks[i - 1].id, to: tasks[i].id, type: 'depends_on' });
    }
    return edges;
  }
}
