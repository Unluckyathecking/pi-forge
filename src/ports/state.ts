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
  FailedTaskMarker,
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
  /** Persist the entire ledger (e.g. after finalizing summary at goal close). */
  saveEvidenceLedger(goalId: string, ledger: EvidenceLedger): Promise<void>;

  // ── Proof Artifacts ──
  saveProofArtifact(goalId: string, artifact: ProofArtifact): Promise<void>;
  loadProofArtifact(goalId: string, artifactId: string): Promise<ProofArtifact | undefined>;
  listProofArtifacts(goalId: string): Promise<string[]>;

  // ── Checkpoints ──
  saveCheckpoint(checkpoint: StateCheckpoint): Promise<void>;
  loadCheckpoint(checkpointId: string): Promise<StateCheckpoint | undefined>;
  listCheckpoints(goalId: string): Promise<StateCheckpoint[]>;

  // ── Failed-task markers (Phase 2 preservation) ──
  saveFailedMarker(marker: FailedTaskMarker): Promise<void>;
  loadFailedMarker(taskId: string): Promise<FailedTaskMarker | undefined>;
  listFailedMarkers(): Promise<string[]>;  // returns task_ids
  deleteFailedMarker(taskId: string): Promise<void>;

  /** Health check */
  health(): Promise<{ ok: boolean; message?: string }>;
}
