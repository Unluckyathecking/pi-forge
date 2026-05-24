import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemStateAdapter } from '../../src/adapters/state.js';
import { StateError } from '../../src/core/errors.js';
import type { EvidenceLedger, FailedTaskMarker, ProofArtifact, TaskGraph } from '../../src/core/types.js';

function makeGraph(goalId: string): TaskGraph {
  return {
    goal_id: goalId,
    version: '1.0.0',
    created_at: new Date().toISOString(),
    tasks: [
      {
        id: 't1',
        level: 2,
        title: 'Do thing',
        status: 'pending',
        proof_requirements: [],
        input_contracts: [],
        output_contracts: [],
        estimated_minutes: 10,
      },
    ],
    edges: [],
  };
}

function makeArtifact(goalId: string, artifactId: string): ProofArtifact {
  return {
    artifact_id: artifactId,
    task_id: 't1',
    goal_id: goalId,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    agent_role: 'coder',
    claims: [],
    summary: { files_changed: 1, lines_added: 1, lines_removed: 0, tests_added: 0, duration_seconds: 1 },
  };
}

describe('FilesystemStateAdapter', () => {
  let workdir: string;
  let adapter: FilesystemStateAdapter;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'pi-forge-state-'));
    adapter = new FilesystemStateAdapter();
    await adapter.init(join(workdir, 'state'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it('round-trips a task graph', async () => {
    const graph = makeGraph('goal-x');
    await adapter.saveTaskGraph('goal-x', graph);
    const loaded = await adapter.loadTaskGraph('goal-x');
    expect(loaded?.goal_id).toBe('goal-x');
    expect(loaded?.tasks).toHaveLength(1);
  });

  it('lists saved task graphs', async () => {
    await adapter.saveTaskGraph('a', makeGraph('a'));
    await adapter.saveTaskGraph('b', makeGraph('b'));
    const ids = await adapter.listTaskGraphs();
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('returns undefined for a missing task graph', async () => {
    const loaded = await adapter.loadTaskGraph('ghost');
    expect(loaded).toBeUndefined();
  });

  it('appends evidence entries with monotonic seq', async () => {
    await adapter.createEvidenceLedger('g1');
    await adapter.appendEvidenceEntry('g1', {
      seq: 0,
      timestamp: new Date().toISOString(),
      type: 'goal_intake',
      description: 'first',
    });
    await adapter.appendEvidenceEntry('g1', {
      seq: 0,
      timestamp: new Date().toISOString(),
      type: 'task_started',
      description: 'second',
    });
    const ledger = await adapter.loadEvidenceLedger('g1');
    expect(ledger?.entries).toHaveLength(2);
    expect(ledger?.entries[0].seq).toBeLessThan(ledger?.entries[1].seq ?? 0);
  });

  it('persists and retrieves proof artifacts', async () => {
    const artifact = makeArtifact('g2', 'proof-1');
    await adapter.saveProofArtifact('g2', artifact);
    const loaded = await adapter.loadProofArtifact('g2', 'proof-1');
    expect(loaded?.artifact_id).toBe('proof-1');
    const list = await adapter.listProofArtifacts('g2');
    expect(list).toContain('proof-1');
  });

  it('reports healthy after init', async () => {
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  });

  it('round-trips a checkpoint and lists it by goal id', async () => {
    const checkpoint = {
      checkpoint_id: 'chk-1',
      goal_id: 'g-cp',
      timestamp: new Date().toISOString(),
      session_id: 's',
      task_graph: { path: '.pi/state/task-graphs/g-cp.json', hash: 'sha256:abc' },
      evidence_ledger: { path: '.pi/state/evidence/g-cp/ledger.json', last_seq: 0 },
      active_worktrees: [],
      pending_decisions: [],
    };
    await adapter.saveCheckpoint(checkpoint);
    const loaded = await adapter.loadCheckpoint('chk-1');
    expect(loaded?.checkpoint_id).toBe('chk-1');
    const list = await adapter.listCheckpoints('g-cp');
    expect(list).toHaveLength(1);
    expect(list[0].checkpoint_id).toBe('chk-1');
  });

  it('returns empty lists when storage directories do not exist', async () => {
    const fresh = new FilesystemStateAdapter();
    await fresh.init(join(workdir, 'state-empty'));
    const graphs = await fresh.listTaskGraphs();
    const proofs = await fresh.listProofArtifacts('nope');
    const checkpoints = await fresh.listCheckpoints('nope');
    expect(graphs).toEqual([]);
    expect(proofs).toEqual([]);
    expect(checkpoints).toEqual([]);
  });

  it('reports unhealthy when base path is missing', async () => {
    const fresh = new FilesystemStateAdapter();
    await fresh.init(join(workdir, 'state-gone'));
    await rm(join(workdir, 'state-gone'), { recursive: true, force: true });
    const health = await fresh.health();
    expect(health.ok).toBe(false);
  });

  it('persists the finalized evidence ledger via saveEvidenceLedger', async () => {
    await adapter.createEvidenceLedger('g-final');
    const ledger: EvidenceLedger = {
      goal_id: 'g-final',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      entries: [
        { seq: 1, timestamp: new Date().toISOString(), type: 'goal_intake', description: 'go' },
        { seq: 2, timestamp: new Date().toISOString(), type: 'task_completed', description: 'ok' },
      ],
      summary: {
        total_entries: 2,
        tasks_completed: 1,
        tasks_failed: 0,
        total_duration_seconds: 5,
        final_status: 'success',
      },
    };
    await adapter.saveEvidenceLedger('g-final', ledger);
    const loaded = await adapter.loadEvidenceLedger('g-final');
    expect(loaded?.entries).toHaveLength(2);
    expect(loaded?.summary?.final_status).toBe('success');
  });

  it('rejects ids that contain path-traversal characters', async () => {
    const graph: TaskGraph = makeGraph('safe-id');
    await expect(adapter.saveTaskGraph('../escape', graph)).rejects.toBeInstanceOf(StateError);
    await expect(adapter.loadTaskGraph('../escape')).rejects.toBeInstanceOf(StateError);
    await expect(
      adapter.saveProofArtifact('safe-id', { ...makeArtifact('safe-id', '../bad'), artifact_id: '../bad' })
    ).rejects.toBeInstanceOf(StateError);
  });

  function makeMarker(taskId: string): FailedTaskMarker {
    return {
      task_id: taskId,
      goal_id: 'g1',
      failed_at: '2026-05-24T00:00:00.000Z',
      failure_kind: 'gate_failure',
      branch: `forge/task-${taskId}`,
      tag_ref: `refs/forge/failed/g1/${taskId}`,
      commit_sha: 'a'.repeat(40),
      wip_commit_was_empty: false,
      worktree_path: `/tmp/wt/${taskId}.failed`,
      gates: [{ name: 'typecheck', status: 'fail', exit_code: 2, stderr_first_line: 'TS2304' }],
      files_modified: ['src/foo.ts'],
      lines_added: 10,
      lines_removed: 2,
      recovery_hint: 'inspect to see',
      operator_commands: { inspect: 'pi-forge inspect t1', salvage: 'pi-forge salvage t1', retry: 'pi-forge retry t1', purge: 'pi-forge cleanup --task t1' },
    };
  }

  it('saveFailedMarker + loadFailedMarker roundtrip', async () => {
    const marker = makeMarker('task1');
    await adapter.saveFailedMarker(marker);
    const loaded = await adapter.loadFailedMarker('task1');
    expect(loaded).toEqual(marker);
  });

  it('loadFailedMarker returns undefined for unknown id', async () => {
    const loaded = await adapter.loadFailedMarker('does-not-exist');
    expect(loaded).toBeUndefined();
  });

  it('listFailedMarkers returns task ids', async () => {
    await adapter.saveFailedMarker(makeMarker('a'));
    await adapter.saveFailedMarker(makeMarker('b'));
    const ids = await adapter.listFailedMarkers();
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('deleteFailedMarker is idempotent on missing ids', async () => {
    await expect(adapter.deleteFailedMarker('not-there')).resolves.toBeUndefined();
  });

  it('deleteFailedMarker removes existing markers', async () => {
    await adapter.saveFailedMarker(makeMarker('z'));
    expect(await adapter.loadFailedMarker('z')).toBeDefined();
    await adapter.deleteFailedMarker('z');
    expect(await adapter.loadFailedMarker('z')).toBeUndefined();
  });

  it('saveFailedMarker rejects unsafe taskId', async () => {
    const marker = { ...makeMarker('../escape'), task_id: '../escape' };
    await expect(adapter.saveFailedMarker(marker)).rejects.toThrow(StateError);
  });
});
