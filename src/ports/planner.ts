/**
 * PlannerPort — Hexagonal port for task decomposition and contract generation
 *
 * Adapters: llm-based (default), rule-based, hybrid
 */

import type { TaskGraph, Task, ProofRequirement } from '../core/types.js';

export interface DecompositionRequest {
  readonly goal: string;
  readonly context?: string;
  readonly constraints?: {
    readonly max_depth?: number;
    readonly time_budget_minutes?: number;
    readonly approval_mode?: 'auto' | 'confirm' | 'review';
  };
}

export interface ContractSet {
  readonly type_contracts: string[];
  readonly api_contracts: string[];
  readonly behavior_contracts: string[];
  readonly security_contracts: string[];
}

export interface PlannerPort {
  readonly name: string;

  /** Decompose a goal into a task graph */
  decompose(request: DecompositionRequest): Promise<TaskGraph>;

  /** Refine an existing task graph based on new information */
  refineGraph(graph: TaskGraph, feedback: string): Promise<TaskGraph>;

  /** Generate proof requirements for a task */
  generateProofRequirements(task: Task): Promise<ProofRequirement[]>;

  /** Draft contracts for a task */
  draftContracts(task: Task): Promise<ContractSet>;

  /** Estimate effort for a task in minutes */
  estimateEffort(task: Task): Promise<number>;

  /** Health check */
  health(): Promise<{ ok: boolean; message?: string }>;
}
