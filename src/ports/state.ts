/**
 * StatePort — Hexagonal port for durable state persistence
 *
 * Adapters: filesystem (default), database, cloud-storage
 */

import type {
  EvidenceLedger,
  EvidenceEntry,
  StateCheckpoint,
  TaskGraph,
  ProofArtifact,
} from '../core/types.js';

export interface StatePort {
  readonly name: string;

  /** Initialize storage paths */
  init(basePath: string): Promise<void>;

  // ── Task Graph ──
  saveTaskGraph(goalId: string, graph: TaskGraph): Promise<void>;
  loadTaskGraph(goalId: string): Promise<TaskGraph | undefined>;
  listTaskGraphs(): Promise<string[]>;

  // ── Evidence Ledger ──
  createEvidenceLedger(goalId: string): Promise<EvidenceLedger>;
  appendEvidenceEntry(goalId: string, entry: EvidenceEntry): Promise<void>;
  loadEvidenceLedger(goalId: string): Promise<EvidenceLedger | undefined>;

  // ── Proof Artifacts ──
  saveProofArtifact(goalId: string, artifact: ProofArtifact): Promise<void>;
  loadProofArtifact(goalId: string, artifactId: string): Promise<ProofArtifact | undefined>;
  listProofArtifacts(goalId: string): Promise<string[]>;

  // ── Checkpoints ──
  saveCheckpoint(checkpoint: StateCheckpoint): Promise<void>;
  loadCheckpoint(checkpointId: string): Promise<StateCheckpoint | undefined>;
  listCheckpoints(goalId: string): Promise<StateCheckpoint[]>;

  /** Health check */
  health(): Promise<{ ok: boolean; message?: string }>;
}
