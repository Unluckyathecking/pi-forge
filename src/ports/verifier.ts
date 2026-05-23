/**
 * VerifierPort — Hexagonal port for quality gate execution
 *
 * Adapters: local-command (default), ci-runner, sandbox
 */

import type { GateStatus, GateType, ProofArtifact, RiskScore } from '../core/types.js';

export interface GateResult {
  readonly gate: GateType;
  readonly status: GateStatus;
  readonly command: string;
  readonly exit_code: number;
  readonly output: string;
  readonly duration_ms: number;
}

export interface GateConfig {
  readonly enabled: boolean;
  readonly fail_on_error?: boolean;
  readonly timeout_seconds?: number;
  readonly coverage_threshold?: number;
  readonly checks?: string[];
}

export interface VerifierPort {
  readonly name: string;

  /** Initialize with project root and gate configuration */
  init(projectRoot: string, config: Record<string, GateConfig>): Promise<void>;

  /** Run a single gate */
  runGate(gate: GateType, worktreePath: string): Promise<GateResult>;

  /** Run all configured gates in order */
  runAllGates(worktreePath: string): Promise<GateResult[]>;

  /** Validate a proof artifact against task requirements */
  validateProofArtifact(artifact: ProofArtifact, requiredGates: GateType[]): Promise<{ valid: boolean; missing: GateType[] }>;

  /** Compute risk score for changes in a worktree */
  scoreRisk(worktreePath: string, options?: { diffMaxLines?: number; diffMaxFiles?: number }): Promise<RiskScore>;

  /** Scan diff for suspicious patterns */
  scanDiff(worktreePath: string, patterns: string[]): Promise<{ matches: Array<{ file: string; line: number; pattern: string }> }>;

  /** Health check */
  health(): Promise<{ ok: boolean; message?: string }>;
}
