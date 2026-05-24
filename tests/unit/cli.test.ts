import { describe, it, expect } from '@jest/globals';
import {
  parseDurationMs,
  stripFailedSuffix,
  renderInspect,
  renderEntry,
  findActiveTask,
} from '../../src/cli/index.js';
import type {
  EvidenceEntry,
  EvidenceLedger,
  FailedTaskMarker,
} from '../../src/core/types.js';

describe('parseDurationMs', () => {
  it('parses days', () => {
    expect(parseDurationMs('7d')).toBe(7 * 24 * 3600 * 1000);
  });

  it('parses hours', () => {
    expect(parseDurationMs('24h')).toBe(24 * 3600 * 1000);
  });

  it('parses minutes', () => {
    expect(parseDurationMs('30m')).toBe(30 * 60 * 1000);
  });

  it('returns 0 for 0d', () => {
    expect(parseDurationMs('0d')).toBe(0);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDurationMs('  5h  ')).toBe(5 * 3600 * 1000);
  });

  it('rejects malformed inputs', () => {
    expect(() => parseDurationMs('7days')).toThrow(/Invalid duration/);
    expect(() => parseDurationMs('week')).toThrow(/Invalid duration/);
    expect(() => parseDurationMs('')).toThrow(/Invalid duration/);
    expect(() => parseDurationMs('7s')).toThrow(/Invalid duration/);
    expect(() => parseDurationMs('-1d')).toThrow(/Invalid duration/);
  });
});

describe('stripFailedSuffix', () => {
  it('removes plain .failed suffix', () => {
    expect(stripFailedSuffix('/tmp/wt/task-1.failed')).toBe('/tmp/wt/task-1');
  });

  it('removes .failed-<timestamp> suffix', () => {
    expect(stripFailedSuffix('/tmp/wt/task-1.failed-1714560000')).toBe(
      '/tmp/wt/task-1',
    );
  });

  it('leaves paths without a .failed suffix unchanged', () => {
    expect(stripFailedSuffix('/tmp/wt/regular-task')).toBe(
      '/tmp/wt/regular-task',
    );
  });

  it('only strips a trailing match', () => {
    // The .failed substring in the middle of the path must not be touched.
    expect(stripFailedSuffix('/tmp/.failed/wt/task-1')).toBe(
      '/tmp/.failed/wt/task-1',
    );
  });
});

function fixtureMarker(overrides: Partial<FailedTaskMarker> = {}): FailedTaskMarker {
  return {
    task_id: 't1',
    goal_id: 'g1',
    failed_at: '2026-05-24T00:00:00.000Z',
    failure_kind: 'gate_failure',
    branch: 'forge/task-t1-foo',
    tag_ref: 'refs/forge/failed/g1/t1',
    commit_sha: 'a'.repeat(40),
    wip_commit_was_empty: false,
    worktree_path: '/tmp/wt/t1.failed',
    gates: [
      { name: 'lint', status: 'pass', exit_code: 0 },
      {
        name: 'typecheck',
        status: 'fail',
        exit_code: 2,
        stderr_first_line: "error TS2304: Cannot find name 'foo'.",
      },
    ],
    files_modified: ['src/foo.ts', 'src/bar.ts'],
    lines_added: 12,
    lines_removed: 3,
    recovery_hint: 'Open the worktree and fix the TS2304 error.',
    operator_commands: {
      inspect: 'pi-forge inspect t1',
      salvage: 'pi-forge salvage t1',
      retry: 'pi-forge retry t1',
      purge: 'pi-forge cleanup --task t1 --yes',
    },
    ...overrides,
  };
}

describe('renderInspect', () => {
  it('includes the task id and goal id in the header', () => {
    const out = renderInspect(fixtureMarker());
    expect(out).toContain('t1');
    expect(out).toContain('g1');
  });

  it('lists every gate with status and exit code', () => {
    const out = renderInspect(fixtureMarker());
    expect(out).toContain('lint');
    expect(out).toContain('typecheck');
    expect(out).toContain('TS2304');
  });

  it('reports diff stats', () => {
    const out = renderInspect(fixtureMarker());
    expect(out).toContain('+12');
    expect(out).toContain('-3');
    expect(out).toContain('2 file(s)');
  });

  it('includes the recovery hint and every operator command', () => {
    const marker = fixtureMarker();
    const out = renderInspect(marker);
    expect(out).toContain(marker.recovery_hint);
    expect(out).toContain(marker.operator_commands.inspect);
    expect(out).toContain(marker.operator_commands.salvage);
    expect(out).toContain(marker.operator_commands.retry);
    expect(out).toContain(marker.operator_commands.purge);
  });

  it('handles markers with no captured gate results', () => {
    const out = renderInspect(fixtureMarker({ gates: [] }));
    expect(out).toContain('no gate results captured');
  });

  it('omits the worktree line when no path is set', () => {
    const out = renderInspect(fixtureMarker({ worktree_path: undefined }));
    expect(out).not.toContain('worktree:');
  });
});

// ── pi-forge watch helpers ──

function fixtureEntry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    seq: 1,
    timestamp: '2026-05-24T12:14:02.000Z',
    type: 'task_started',
    task_id: 'plan',
    description: 'Plan architecture and contracts',
    ...overrides,
  };
}

function fixtureLedger(entries: EvidenceEntry[]): EvidenceLedger {
  return {
    goal_id: 'g1',
    version: '1.0.0',
    created_at: '2026-05-24T12:14:00.000Z',
    entries,
  };
}

describe('renderEntry', () => {
  it('includes task_id, type, description, and a formatted timestamp', () => {
    const entry = fixtureEntry({
      seq: 7,
      type: 'task_completed',
      task_id: 'implement',
      description: 'Implement feature',
    });
    const out = renderEntry(entry);
    expect(out).toContain('task_completed');
    expect(out).toContain('implement');
    expect(out).toContain('Implement feature');
    // The timestamp is locale-formatted but always wrapped in [ ].
    expect(out).toMatch(/\[[^\]]+\]/);
  });
});

describe('findActiveTask', () => {
  it('returns the most-recent task_started without a matching completed/failed', () => {
    const ledger = fixtureLedger([
      fixtureEntry({ seq: 1, type: 'task_started', task_id: 'plan' }),
      fixtureEntry({ seq: 2, type: 'task_completed', task_id: 'plan' }),
      fixtureEntry({ seq: 3, type: 'task_started', task_id: 'implement' }),
    ]);
    const active = findActiveTask(ledger);
    expect(active?.task_id).toBe('implement');
  });

  it('returns undefined when no task_started is in-flight', () => {
    const ledger = fixtureLedger([
      fixtureEntry({ seq: 1, type: 'task_started', task_id: 'plan' }),
      fixtureEntry({ seq: 2, type: 'task_completed', task_id: 'plan' }),
    ]);
    expect(findActiveTask(ledger)).toBeUndefined();
  });

  it('ignores task_started when a matching task_failed exists', () => {
    const ledger = fixtureLedger([
      fixtureEntry({ seq: 1, type: 'task_started', task_id: 'implement' }),
      fixtureEntry({ seq: 2, type: 'task_failed', task_id: 'implement' }),
    ]);
    expect(findActiveTask(ledger)).toBeUndefined();
  });
});
