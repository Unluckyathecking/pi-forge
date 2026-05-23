/**
 * Pi Forge Core Domain Types
 *
 * These types define the contract for the entire system.
 * They mirror the JSON schemas in the harness specification.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Task Graph
// ─────────────────────────────────────────────────────────────────────────────

export type TaskLevel = 0 | 1 | 2 | 3;

export type TaskStatus =
  | 'pending'
  | 'blocked'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type EdgeType = 'depends_on' | 'produces_for' | 'conflicts_with';

export interface TaskEdge {
  readonly from: string;
  readonly to: string;
  readonly type: EdgeType;
}

export type GateType =
  | 'lint'
  | 'typecheck'
  | 'test'
  | 'build'
  | 'security_scan'
  | 'contract_verify'
  | 'diff_review'
  | 'manual_check';

export type GateStatus = 'pass' | 'fail' | 'skip' | 'warn';

export interface ProofRequirement {
  readonly gate: GateType;
  readonly required: boolean;
  readonly command?: string;
  readonly expected_exit_code?: number;
  readonly artifact_pattern?: string;
}

export interface Task {
  readonly id: string;
  readonly level: TaskLevel;
  readonly title: string;
  readonly description?: string;
  status: TaskStatus;
  owner?: string;
  worktree?: string;
  branch?: string;
  readonly proof_requirements: ProofRequirement[];
  readonly input_contracts: string[];
  readonly output_contracts: string[];
  readonly estimated_minutes: number;
  started_at?: string;
  completed_at?: string;
  evidence_id?: string;
}

export interface TaskGraph {
  readonly goal_id: string;
  readonly version: string;
  readonly created_at: string;
  tasks: Task[];
  edges: TaskEdge[];
  readonly constraints?: {
    readonly max_depth?: number;
    readonly time_budget_minutes?: number;
    readonly token_budget?: number;
    readonly approval_mode?: 'auto' | 'confirm' | 'review';
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Artifact
// ─────────────────────────────────────────────────────────────────────────────

export type AgentRole =
  | 'coordinator'
  | 'planner'
  | 'coder'
  | 'reviewer'
  | 'qa'
  | 'security'
  | 'integrator';

export type VerifierType = 'mechanical' | 'agent' | 'human';

export interface ProofClaim {
  readonly gate: GateType;
  readonly status: GateStatus;
  readonly command?: string;
  readonly exit_code?: number;
  readonly output_excerpt?: string;
  readonly artifact_path?: string;
  readonly timestamp?: string;
  readonly verifier?: VerifierType;
}

export interface ProofArtifact {
  readonly artifact_id: string;
  readonly task_id: string;
  readonly goal_id: string;
  readonly version: string;
  readonly timestamp: string;
  readonly agent_role: AgentRole;
  readonly worktree?: string;
  readonly commit_sha?: string;
  readonly claims: ProofClaim[];
  readonly summary?: {
    readonly files_changed?: number;
    readonly lines_added?: number;
    readonly lines_removed?: number;
    readonly tests_added?: number;
    readonly duration_seconds?: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Ledger
// ─────────────────────────────────────────────────────────────────────────────

export type EvidenceEntryType =
  | 'goal_intake'
  | 'plan_created'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'gate_passed'
  | 'gate_failed'
  | 'merge'
  | 'rollback'
  | 'decision'
  | 'checkpoint'
  | 'escalation';

export interface EvidenceEntry {
  readonly seq: number;
  readonly timestamp: string;
  readonly type: EvidenceEntryType;
  readonly task_id?: string;
  readonly agent_role?: string;
  readonly description: string;
  readonly data?: Record<string, unknown>;
  readonly artifact_refs?: string[];
}

export interface EvidenceLedger {
  readonly goal_id: string;
  readonly version: string;
  readonly created_at: string;
  readonly closed_at?: string;
  entries: EvidenceEntry[];
  readonly summary?: {
    readonly total_entries?: number;
    readonly tasks_completed?: number;
    readonly tasks_failed?: number;
    readonly total_duration_seconds?: number;
    readonly final_status?: 'success' | 'partial' | 'failure' | 'cancelled';
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State Checkpoint
// ─────────────────────────────────────────────────────────────────────────────

export interface ActiveWorktree {
  readonly task_id: string;
  readonly path: string;
  readonly branch: string;
  readonly last_commit?: string;
  readonly dirty: boolean;
}

export interface PendingDecision {
  readonly decision_id: string;
  readonly description: string;
  readonly blocked_tasks: string[];
}

export interface StateCheckpoint {
  readonly checkpoint_id: string;
  readonly goal_id: string;
  readonly timestamp: string;
  readonly session_id?: string;
  readonly task_graph: {
    readonly path: string;
    readonly hash: string;
  };
  readonly evidence_ledger: {
    readonly path: string;
    readonly last_seq: number;
  };
  readonly active_worktrees: ActiveWorktree[];
  readonly memory_index?: Record<string, unknown>;
  readonly pending_decisions: PendingDecision[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Scoring
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskWeights {
  readonly policy_violations: number;
  readonly suspicious_patterns: number;
  readonly test_failures: number;
  readonly contract_drift: number;
  readonly diff_size_anomaly: number;
}

export interface RiskThresholds {
  readonly auto_promote: number;
  readonly user_confirm: number;
  readonly security_review: number;
  readonly auto_deny: number;
}

export interface RiskScore {
  readonly score: number;
  readonly components: Record<string, number>;
  readonly decision: 'auto_promote' | 'user_confirm' | 'security_review' | 'auto_deny';
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export interface ForgeConfig {
  readonly forge: {
    readonly version: string;
    readonly name: string;
    readonly description: string;
  };
  readonly core: {
    readonly architecture: string;
    readonly levels: Record<string, { readonly scope: string; readonly max_lines: number; readonly agent_pool: number }>;
    readonly escalation: {
      readonly auto_escalate: boolean;
      readonly human_pause_on: string[];
      readonly max_escalation_depth: number;
    };
  };
  readonly proof_carrying: {
    readonly enabled: boolean;
    readonly required_gates: GateType[];
    readonly advisory_gates: GateType[];
    readonly artifact: {
      readonly schema: string;
      readonly required_claims_min: number;
      readonly max_output_excerpt_length: number;
      readonly persist_path: string;
    };
  };
  readonly git: {
    readonly branch_prefix: string;
    readonly session_branch_template: string;
    readonly task_branch_template: string;
    readonly worktree_base: string;
    readonly auto_clean_worktrees: boolean;
    readonly retain_failed_branches: boolean;
    readonly archive_after_days: number;
    readonly commit: {
      readonly require_conventional_commits: boolean;
      readonly include_task_id: boolean;
      readonly include_evidence_summary: boolean;
      readonly max_commit_size_lines: number;
    };
    readonly merge: {
      readonly strategy: string;
      readonly require_linear_history: boolean;
      readonly squash_on_merge: boolean;
    };
  };
  readonly agents: {
    readonly roles: Record<string, {
      readonly description: string;
      readonly capabilities: string[];
      readonly max_concurrent_tasks: number;
    }>;
    readonly capability_routing: {
      readonly enabled: boolean;
      readonly registry_path?: string;
      readonly fallback_role?: string;
    };
  };
  readonly gates: {
    readonly mechanical: {
      readonly order: GateType[];
      readonly lint: { readonly enabled: boolean; readonly fail_on_error: boolean; readonly auto_fix: boolean };
      readonly typecheck: { readonly enabled: boolean; readonly fail_on_error: boolean };
      readonly test: { readonly enabled: boolean; readonly require_pass: boolean; readonly timeout_seconds: number; readonly coverage_threshold: number };
      readonly build: { readonly enabled: boolean; readonly fail_on_error: boolean; readonly timeout_seconds: number };
      readonly security_scan: { readonly enabled: boolean; readonly checks: string[]; readonly fail_on_critical: boolean };
    };
    readonly review: {
      readonly diff_max_lines: number;
      readonly diff_max_files: number;
      readonly deny_patterns: string[];
      readonly protected_files: string[];
    };
    readonly risk: {
      readonly weights: RiskWeights;
      readonly thresholds: RiskThresholds;
    };
  };
  readonly state: {
    readonly paths: Record<string, string>;
    readonly checkpoints: {
      readonly auto_write_before: string[];
      readonly max_checkpoints_per_goal: number;
      readonly compress_after_days: number;
    };
  };
  readonly approval: {
    readonly auto_approve: string[];
    readonly require_confirm: string[];
    readonly require_review: string[];
  };
}
