/**
 * FilesystemStateAdapter
 *
 * Implements StatePort using Node.js fs/promises with proper-lockfile
 * for concurrent safety.
 */

import { mkdir, writeFile, readFile, readdir, access, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { lock } from 'proper-lockfile';
import type {
  EvidenceLedger,
  EvidenceEntry,
  StateCheckpoint,
  TaskGraph,
  ProofArtifact,
  FailedTaskMarker,
} from '../core/types.js';
import type { StatePort } from '../ports/state.js';
import { StateError } from '../core/errors.js';

/**
 * Restrict path components to a slug-friendly alphabet so a hostile
 * `artifact_id` or `goal_id` deserialized from external state cannot
 * traverse outside the configured base path.
 */
const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
function assertSafeId(id: string, field: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new StateError(`Unsafe ${field}: contains characters outside [A-Za-z0-9_.-]`, { id });
  }
}

export class FilesystemStateAdapter implements StatePort {
  readonly name = 'filesystem';
  private basePath = '.pi/state';

  async init(basePath: string): Promise<void> {
    this.basePath = basePath;
    const dirs: string[] = [
      join(this.basePath, 'task-graphs'),
      join(this.basePath, 'evidence'),
      join(this.basePath, 'checkpoints'),
      join(this.basePath, 'failed-tasks'),
    ];
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }
  }

  private taskGraphPath(goalId: string): string {
    assertSafeId(goalId, 'goalId');
    return join(this.basePath, 'task-graphs', `${goalId}.json`);
  }

  private evidenceDir(goalId: string): string {
    assertSafeId(goalId, 'goalId');
    return join(this.basePath, 'evidence', goalId);
  }

  private ledgerPath(goalId: string): string {
    return join(this.evidenceDir(goalId), 'ledger.json');
  }

  private proofPath(goalId: string, artifactId: string): string {
    assertSafeId(artifactId, 'artifactId');
    return join(this.evidenceDir(goalId), 'proofs', `${artifactId}.json`);
  }

  private checkpointPath(checkpointId: string): string {
    assertSafeId(checkpointId, 'checkpointId');
    return join(this.basePath, 'checkpoints', `${checkpointId}.json`);
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      throw new StateError(
        `Failed to write state to ${path}`,
        { cause: err instanceof Error ? err.message : String(err) }
      );
    }
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as T;
    } catch (err) {
      // ENOENT (file not found) is a non-error read miss; surface as undefined
      // so callers can distinguish "not yet written" from genuine IO failure.
      const code = (err as { code?: unknown } | null)?.code;
      if (code === 'ENOENT') {
        return undefined;
      }
      throw new StateError(
        `Failed to read state from ${path}`,
        { cause: err instanceof Error ? err.message : String(err) }
      );
    }
  }

  // ── Task Graph ──
  async saveTaskGraph(goalId: string, graph: TaskGraph): Promise<void> {
    await this.writeJson(this.taskGraphPath(goalId), graph);
  }

  async loadTaskGraph(goalId: string): Promise<TaskGraph | undefined> {
    return this.readJson<TaskGraph>(this.taskGraphPath(goalId));
  }

  async listTaskGraphs(): Promise<string[]> {
    const dir = join(this.basePath, 'task-graphs');
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5));
  }

  // ── Evidence Ledger ──
  async createEvidenceLedger(goalId: string): Promise<EvidenceLedger> {
    const ledger: EvidenceLedger = {
      goal_id: goalId,
      version: '1.0.0',
      created_at: new Date().toISOString(),
      entries: [],
    };
    await this.writeJson(this.ledgerPath(goalId), ledger);
    return ledger;
  }

  async appendEvidenceEntry(
    goalId: string,
    entry: EvidenceEntry
  ): Promise<void> {
    const ledgerPath = this.ledgerPath(goalId);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lock(ledgerPath, { retries: 5 });
      let ledger = await this.readJson<EvidenceLedger>(ledgerPath);
      if (!ledger) {
        ledger = await this.createEvidenceLedger(goalId);
      }
      const nextSeq: number =
        ledger.entries.length > 0
          ? ledger.entries[ledger.entries.length - 1].seq + 1
          : 1;
      const entryWithSeq: EvidenceEntry = { ...entry, seq: nextSeq };
      ledger.entries.push(entryWithSeq);
      await this.writeJson(ledgerPath, ledger);
    } catch (err) {
      if (err instanceof StateError) throw err;
      throw new StateError(
        `Failed to append evidence entry for ${goalId}`,
        { cause: err instanceof Error ? err.message : String(err) }
      );
    } finally {
      if (release) {
        await release();
      }
    }
  }

  async loadEvidenceLedger(goalId: string): Promise<EvidenceLedger | undefined> {
    return this.readJson<EvidenceLedger>(this.ledgerPath(goalId));
  }

  async saveEvidenceLedger(goalId: string, ledger: EvidenceLedger): Promise<void> {
    const ledgerPath = this.ledgerPath(goalId);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lock(ledgerPath, { retries: 5 });
      await this.writeJson(ledgerPath, ledger);
    } catch (err) {
      if (err instanceof StateError) throw err;
      throw new StateError(
        `Failed to save evidence ledger for ${goalId}`,
        { cause: err instanceof Error ? err.message : String(err) }
      );
    } finally {
      if (release) {
        await release();
      }
    }
  }

  // ── Proof Artifacts ──
  async saveProofArtifact(
    goalId: string,
    artifact: ProofArtifact
  ): Promise<void> {
    await this.writeJson(
      this.proofPath(goalId, artifact.artifact_id),
      artifact
    );
  }

  async loadProofArtifact(
    goalId: string,
    artifactId: string
  ): Promise<ProofArtifact | undefined> {
    return this.readJson<ProofArtifact>(this.proofPath(goalId, artifactId));
  }

  async listProofArtifacts(goalId: string): Promise<string[]> {
    const dir = join(this.evidenceDir(goalId), 'proofs');
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5));
  }

  // ── Checkpoints ──
  async saveCheckpoint(checkpoint: StateCheckpoint): Promise<void> {
    await this.writeJson(
      this.checkpointPath(checkpoint.checkpoint_id),
      checkpoint
    );
  }

  async loadCheckpoint(
    checkpointId: string
  ): Promise<StateCheckpoint | undefined> {
    return this.readJson<StateCheckpoint>(this.checkpointPath(checkpointId));
  }

  async listCheckpoints(goalId: string): Promise<StateCheckpoint[]> {
    const dir = join(this.basePath, 'checkpoints');
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const checkpoints: StateCheckpoint[] = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const cp = await this.readJson<StateCheckpoint>(join(dir, file));
      if (cp && cp.goal_id === goalId) {
        checkpoints.push(cp);
      }
    }
    return checkpoints;
  }

  // ── Failed-task Markers ──
  private failedMarkerPath(taskId: string): string {
    assertSafeId(taskId, 'taskId');
    return join(this.basePath, 'failed-tasks', `${taskId}.json`);
  }

  async saveFailedMarker(marker: FailedTaskMarker): Promise<void> {
    await this.writeJson(this.failedMarkerPath(marker.task_id), marker);
  }

  async loadFailedMarker(taskId: string): Promise<FailedTaskMarker | undefined> {
    return this.readJson<FailedTaskMarker>(this.failedMarkerPath(taskId));
  }

  async listFailedMarkers(): Promise<string[]> {
    const dir = join(this.basePath, 'failed-tasks');
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5));
  }

  async deleteFailedMarker(taskId: string): Promise<void> {
    const path = this.failedMarkerPath(taskId);
    try {
      await unlink(path);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === 'ENOENT') return;   // idempotent
      throw new StateError(`Failed to delete marker ${path}`, { cause: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Health ──
  async health(): Promise<{ ok: boolean; message?: string }> {
    try {
      await access(this.basePath);
      return { ok: true };
    } catch {
      return {
        ok: false,
        message: `State base path ${this.basePath} is not accessible`,
      };
    }
  }
}
