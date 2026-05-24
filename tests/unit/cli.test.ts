import { describe, it, expect, afterEach, beforeEach, jest } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDurationMs,
  stripFailedSuffix,
  renderInspect,
  renderEntry,
  findActiveTask,
  formatDuration,
  renderGoalStats,
  renderAggregateStats,
  detectProjectType,
  renderPlanMarkdown,
} from '../../src/cli/index.js';
import type { PlanTemplateInput } from '../../src/cli/index.js';
import { FilesystemStateAdapter } from '../../src/adapters/state.js';
import type {
  EvidenceEntry,
  EvidenceLedger,
  FailedTaskMarker,
  TaskGraph,
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

// ── pi-forge stats helpers ──

describe('formatDuration', () => {
  it('returns ms suffix for sub-second durations', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('returns seconds suffix for durations under a minute', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(1_000)).toBe('1s');
    expect(formatDuration(59_499)).toBe('59s');
  });

  it('returns "Nm Ss" for durations of one minute or more', () => {
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(605_000)).toBe('10m 5s');
  });
});

function makeGoalGraph(goalId: string, taskIds: string[]): TaskGraph {
  return {
    goal_id: goalId,
    version: '1.0.0',
    created_at: '2026-05-24T08:30:00.000Z',
    tasks: taskIds.map((id, idx) => ({
      id,
      level: 2,
      title: `Task ${id}`,
      status: 'pending',
      proof_requirements: [],
      input_contracts: [],
      output_contracts: [],
      estimated_minutes: 5 + idx,
    })),
    edges: [],
  };
}

function makeGoalLedger(
  goalId: string,
  entries: EvidenceEntry[],
  summary?: EvidenceLedger['summary'],
  closedAt?: string,
): EvidenceLedger {
  return {
    goal_id: goalId,
    version: '1.0.0',
    created_at: '2026-05-24T08:30:00.000Z',
    closed_at: closedAt,
    entries,
    summary,
  };
}

describe('renderGoalStats', () => {
  let workdir: string;
  let adapter: FilesystemStateAdapter;
  // We spy on console.log; preserve and restore the real implementation.
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'pi-forge-stats-'));
    adapter = new FilesystemStateAdapter();
    await adapter.init(join(workdir, 'state'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(workdir, { recursive: true, force: true });
  });

  it('prints header, task table, and durations for a real ledger', async () => {
    const goalId = 'goal-render-test';
    const graph = makeGoalGraph(goalId, ['plan', 'implement', 'test']);
    const ledger = makeGoalLedger(
      goalId,
      [
        {
          seq: 1,
          timestamp: '2026-05-24T08:30:43.000Z',
          type: 'task_started',
          task_id: 'plan',
          description: 'Start plan',
        },
        {
          seq: 2,
          timestamp: '2026-05-24T08:30:49.000Z',
          type: 'task_completed',
          task_id: 'plan',
          description: 'Plan complete',
        },
        {
          seq: 3,
          timestamp: '2026-05-24T08:30:50.000Z',
          type: 'task_started',
          task_id: 'implement',
          description: 'Start implement',
        },
        {
          seq: 4,
          timestamp: '2026-05-24T08:48:50.000Z',
          type: 'task_failed',
          task_id: 'implement',
          description: 'Required gate(s) failed: typecheck',
        },
      ],
      {
        final_status: 'partial',
        tasks_completed: 1,
        tasks_failed: 1,
      },
      '2026-05-24T08:49:10.000Z',
    );
    await adapter.saveTaskGraph(goalId, graph);
    // createEvidenceLedger must run first so saveEvidenceLedger can take a
    // proper-lockfile lock on an existing path.
    await adapter.createEvidenceLedger(goalId);
    await adapter.saveEvidenceLedger(goalId, ledger);

    await expect(renderGoalStats(adapter, goalId)).resolves.toBeUndefined();
    const joined = logSpy.mock.calls.map((c) => String(c[0] ?? '')).join('\n');
    expect(joined).toContain(goalId);
    expect(joined).toContain('Tasks (3)');
    // Plan completed in 6s, implement failed after 18m.
    expect(joined).toContain('6s');
    expect(joined).toContain('18m 0s');
    // Skipped/unfinished task should render as skipped, not failed.
    expect(joined).toContain('skipped');
    // Failure reason from the task_failed entry should be surfaced.
    expect(joined).toContain('typecheck');
    // Header shows the final status.
    expect(joined).toContain('partial');
  });
});

describe('renderAggregateStats', () => {
  let workdir: string;
  let adapter: FilesystemStateAdapter;
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'pi-forge-stats-agg-'));
    adapter = new FilesystemStateAdapter();
    await adapter.init(join(workdir, 'state'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(workdir, { recursive: true, force: true });
  });

  it('prints a friendly message when no runs exist', async () => {
    await renderAggregateStats(adapter, 10);
    const joined = logSpy.mock.calls.map((c) => String(c[0] ?? '')).join('\n');
    expect(joined).toContain('No pi-forge runs');
  });

  it('aggregates goal + task counts across multiple ledgers', async () => {
    // Goal A: success with two tasks (plan completed, implement completed).
    const goalA = 'goal-a';
    await adapter.saveTaskGraph(goalA, makeGoalGraph(goalA, ['plan', 'implement']));
    await adapter.createEvidenceLedger(goalA);
    await adapter.saveEvidenceLedger(
      goalA,
      makeGoalLedger(
        goalA,
        [
          {
            seq: 1,
            timestamp: '2026-05-24T08:00:00.000Z',
            type: 'task_started',
            task_id: 'plan',
            description: 'plan',
          },
          {
            seq: 2,
            timestamp: '2026-05-24T08:00:05.000Z',
            type: 'task_completed',
            task_id: 'plan',
            description: 'done',
          },
          {
            seq: 3,
            timestamp: '2026-05-24T08:01:00.000Z',
            type: 'task_started',
            task_id: 'implement',
            description: 'impl',
          },
          {
            seq: 4,
            timestamp: '2026-05-24T08:01:10.000Z',
            type: 'task_completed',
            task_id: 'implement',
            description: 'done',
          },
        ],
        { final_status: 'success', tasks_completed: 2, tasks_failed: 0 },
        '2026-05-24T08:01:11.000Z',
      ),
    );
    // Goal B: failure with one task failed.
    const goalB = 'goal-b';
    await adapter.saveTaskGraph(goalB, makeGoalGraph(goalB, ['implement']));
    await adapter.createEvidenceLedger(goalB);
    await adapter.saveEvidenceLedger(
      goalB,
      makeGoalLedger(
        goalB,
        [
          {
            seq: 1,
            timestamp: '2026-05-24T09:00:00.000Z',
            type: 'task_started',
            task_id: 'implement',
            description: 'impl',
          },
          {
            seq: 2,
            timestamp: '2026-05-24T09:00:30.000Z',
            type: 'task_failed',
            task_id: 'implement',
            description: 'Required gate(s) failed: typecheck',
          },
        ],
        { final_status: 'failure', tasks_completed: 0, tasks_failed: 1 },
        '2026-05-24T09:00:31.000Z',
      ),
    );
    // Add a failure proof so the most-common-failed-gates section renders.
    await adapter.saveProofArtifact(goalB, {
      artifact_id: 'proof-b-1',
      task_id: 'implement',
      goal_id: goalB,
      version: '1.0.0',
      timestamp: '2026-05-24T09:00:30.000Z',
      agent_role: 'coder',
      claims: [],
      all_pass: false,
      failed_gates: ['typecheck'],
    });

    await renderAggregateStats(adapter, 10);
    const joined = logSpy.mock.calls.map((c) => String(c[0] ?? '')).join('\n');
    expect(joined).toContain('Pi Forge — session statistics');
    expect(joined).toContain('Goals:');
    // 2 goals total, 1 success, 1 failure.
    expect(joined).toContain('2');
    expect(joined).toContain('success');
    expect(joined).toContain('failure');
    // 3 tasks total across the two goals (2 + 1).
    expect(joined).toContain('Tasks:');
    expect(joined).toContain('3');
    // Most-common failed gates picks up the typecheck failure.
    expect(joined).toContain('Most-common failed gates');
    expect(joined).toContain('typecheck');
    // Recent goals section appears with both goal ids.
    expect(joined).toContain('Recent goals');
    expect(joined).toContain(goalA);
    expect(joined).toContain(goalB);
  });
});

// ── pi-forge init-plan helpers ──

function planInput(overrides: Partial<PlanTemplateInput> = {}): PlanTemplateInput {
  return {
    goal: 'Test goal',
    scopeIn: ['alpha', 'beta'],
    scopeOut: ['gamma'],
    newFilesEstimate: 2,
    editedFilesEstimate: 1,
    strictPrefs: ['no-any', 'no-as'],
    includeUnitTests: false,
    projectType: 'typescript',
    ...overrides,
  };
}

describe('detectProjectType', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'pi-forge-detect-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("returns 'typescript' for package.json with a typescript devDep", async () => {
    await writeFile(
      join(workdir, 'package.json'),
      JSON.stringify({
        name: 'x',
        devDependencies: { typescript: '^5.0.0' },
      }),
      'utf-8',
    );
    expect(detectProjectType(workdir)).toBe('typescript');
  });

  it("returns 'javascript' for package.json without TypeScript hints", async () => {
    await writeFile(
      join(workdir, 'package.json'),
      JSON.stringify({ name: 'x', main: 'index.js' }),
      'utf-8',
    );
    expect(detectProjectType(workdir)).toBe('javascript');
  });

  it("returns 'rust' when Cargo.toml is present", async () => {
    await writeFile(
      join(workdir, 'Cargo.toml'),
      '[package]\nname = "x"\n',
      'utf-8',
    );
    expect(detectProjectType(workdir)).toBe('rust');
  });

  it("returns 'go' when go.mod is present", async () => {
    await writeFile(join(workdir, 'go.mod'), 'module example.com/x\n', 'utf-8');
    expect(detectProjectType(workdir)).toBe('go');
  });

  it("returns 'python' for pyproject.toml", async () => {
    await writeFile(
      join(workdir, 'pyproject.toml'),
      '[project]\nname = "x"\n',
      'utf-8',
    );
    expect(detectProjectType(workdir)).toBe('python');
  });

  it("returns 'unknown' when no recognised project file is present", () => {
    expect(detectProjectType(workdir)).toBe('unknown');
  });

  it('prefers rust over python when both Cargo.toml and pyproject.toml exist', async () => {
    // Rust detection runs before Python in the chain — this guards the order.
    await writeFile(join(workdir, 'Cargo.toml'), '[package]\nname="x"\n', 'utf-8');
    await writeFile(join(workdir, 'pyproject.toml'), '[project]\nname="x"\n', 'utf-8');
    expect(detectProjectType(workdir)).toBe('rust');
  });
});

describe('renderPlanMarkdown', () => {
  it('includes the goal sentence under §1 Goal', () => {
    const md = renderPlanMarkdown(planInput({ goal: 'Ship the MVP today' }));
    expect(md).toContain('## 1. Goal');
    expect(md).toContain('Ship the MVP today');
  });

  it('renders scope-in items as bullet list items under §2', () => {
    const md = renderPlanMarkdown(
      planInput({ scopeIn: ['real-time animation', 'fallback mode'] }),
    );
    expect(md).toContain('## 2. Scope');
    expect(md).toContain('### In scope');
    expect(md).toContain('- real-time animation');
    expect(md).toContain('- fallback mode');
  });

  it('renders scope-out items as bullet list items', () => {
    const md = renderPlanMarkdown(
      planInput({ scopeOut: ['backend', 'production hardening'] }),
    );
    expect(md).toContain('### Out of scope');
    expect(md).toContain('- backend');
    expect(md).toContain('- production hardening');
  });

  it('scales the File Map row count to newFilesEstimate', () => {
    const md = renderPlanMarkdown(
      planInput({ newFilesEstimate: 5, editedFilesEstimate: 0 }),
    );
    // Each scaffolded NEW row carries the literal " | NEW | " column.
    const newRowCount = (md.match(/\| NEW \|/g) ?? []).length;
    expect(newRowCount).toBeGreaterThanOrEqual(5);
  });

  it('scales the File Map row count to editedFilesEstimate', () => {
    const md = renderPlanMarkdown(
      planInput({ newFilesEstimate: 0, editedFilesEstimate: 4 }),
    );
    const editRowCount = (md.match(/\| EDIT \|/g) ?? []).length;
    expect(editRowCount).toBeGreaterThanOrEqual(4);
  });

  it('emits the ESLint section for TypeScript projects', () => {
    const md = renderPlanMarkdown(planInput({ projectType: 'typescript' }));
    expect(md).toContain('§C. ESLint rules');
  });

  it('omits the ESLint section for non-frontend projects', () => {
    const md = renderPlanMarkdown(planInput({ projectType: 'rust' }));
    expect(md).not.toContain('§C. ESLint rules');
  });

  it('emits Rust-specific gate commands for rust projects', () => {
    const md = renderPlanMarkdown(planInput({ projectType: 'rust' }));
    expect(md).toContain('cargo clippy');
    expect(md).toContain('cargo test');
    expect(md).not.toContain('npm run lint');
  });

  it('emits Python-specific gate commands for python projects', () => {
    const md = renderPlanMarkdown(planInput({ projectType: 'python' }));
    expect(md).toContain('pytest');
    expect(md).toContain('ruff check');
  });

  it('includes the gate-iteration protocol verbatim', () => {
    const md = renderPlanMarkdown(planInput());
    expect(md).toContain('§A. Gate-iteration protocol');
    expect(md).toContain('Stage one file at a time');
    expect(md).toContain('Never disable a gate');
  });

  it('includes the common-failures checklist', () => {
    const md = renderPlanMarkdown(planInput());
    expect(md).toContain('§E. Common-failures checklist');
    expect(md).toContain('Scope creep');
    expect(md).toContain('No silenced gates');
  });

  it('lists the operator-supplied strict prefs in §B', () => {
    const md = renderPlanMarkdown(
      planInput({ strictPrefs: ['custom-rule-x', 'custom-rule-y'] }),
    );
    expect(md).toContain('§B. Strict-mode survival guide');
    expect(md).toContain('custom-rule-x');
    expect(md).toContain('custom-rule-y');
  });

  it('adjusts the §F task-DAG hint when unit tests are omitted', () => {
    const withTests = renderPlanMarkdown(planInput({ includeUnitTests: true }));
    expect(withTests).toContain('plan → implement → test → verify');
    const noTests = renderPlanMarkdown(planInput({ includeUnitTests: false }));
    expect(noTests).toContain('plan → implement → verify');
    expect(noTests).toContain('skip the "test" task');
  });
});
