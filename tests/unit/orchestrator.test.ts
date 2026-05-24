import { describe, it, expect, jest } from '@jest/globals';
import { ForgeOrchestrator } from '../../src/core/orchestrator.js';
import type { ForgeConfig } from '../../src/core/types.js';
import type { GitPort } from '../../src/ports/git.js';
import type { StatePort } from '../../src/ports/state.js';
import type { VerifierPort } from '../../src/ports/verifier.js';
import type { PlannerPort } from '../../src/ports/planner.js';
import type { WorkerPort } from '../../src/ports/worker.js';
import type { Logger } from '../../src/utils/logger.js';

function makeMockConfig(): ForgeConfig {
  return {
    forge: { version: '1.0.0', name: 'pi-forge', description: 'test' },
    core: {
      architecture: 'hexagonal',
      levels: {},
      escalation: { auto_escalate: true, human_pause_on: [], max_escalation_depth: 3 },
    },
    proof_carrying: {
      enabled: true,
      required_gates: ['lint', 'typecheck', 'test'],
      advisory_gates: [],
      artifact: { schema: '', required_claims_min: 3, max_output_excerpt_length: 2000, persist_path: '' },
    },
    git: {
      branch_prefix: 'pi/',
      session_branch_template: 'pi/session/{date}-{goal_slug}',
      task_branch_template: 'pi/task/{task_id}-{slug}',
      worktree_base: '.pi/worktrees/',
      auto_clean_worktrees: true,
      retain_failed_branches: false,
      preserve_worktree_on_failure: false,
      archive_after_days: 7,
      commit: { require_conventional_commits: true, include_task_id: true, include_evidence_summary: true, max_commit_size_lines: 500 },
      merge: { strategy: 'rebase', require_linear_history: true, squash_on_merge: false },
    },
    agents: { roles: {}, capability_routing: { enabled: false } },
    gates: {
      mechanical: { order: [], lint: { enabled: true, fail_on_error: true, auto_fix: false }, typecheck: { enabled: true, fail_on_error: true }, test: { enabled: true, require_pass: true, timeout_seconds: 300, coverage_threshold: 80 }, build: { enabled: true, fail_on_error: true, timeout_seconds: 300 }, security_scan: { enabled: true, checks: [], fail_on_critical: true } },
      review: { diff_max_lines: 1000, diff_max_files: 50, deny_patterns: [], protected_files: [] },
      risk: { weights: { policy_violations: 0.3, suspicious_patterns: 0.25, test_failures: 0.2, contract_drift: 0.15, diff_size_anomaly: 0.1 }, thresholds: { auto_promote: 25, user_confirm: 50, security_review: 75, auto_deny: 90 } },
    },
    state: { paths: {}, checkpoints: { auto_write_before: [], max_checkpoints_per_goal: 50, compress_after_days: 30 } },
    approval: { auto_approve: [], require_confirm: [], require_review: [] },
  };
}

function makeMockGit(): GitPort {
  return {
    name: 'mock-git',
    init: jest.fn<GitPort['init']>().mockResolvedValue(undefined),
    createWorktree: jest.fn<GitPort['createWorktree']>().mockResolvedValue({ path: '/wt', branch: 'b', dirty: false }),
    destroyWorktree: jest.fn<GitPort['destroyWorktree']>().mockResolvedValue(undefined),
    listWorktrees: jest.fn<GitPort['listWorktrees']>().mockResolvedValue([]),
    createBranch: jest.fn<GitPort['createBranch']>().mockResolvedValue(undefined),
    currentBranch: jest.fn<GitPort['currentBranch']>().mockResolvedValue('main'),
    commit: jest.fn<GitPort['commit']>().mockResolvedValue('abc123'),
    diffStats: jest.fn<GitPort['diffStats']>().mockResolvedValue({ files: 1, additions: 10, deletions: 2 }),
    diffSinceBranch: jest.fn<GitPort['diffSinceBranch']>().mockResolvedValue({ files: 2, additions: 50, deletions: 0 }),
    merge: jest.fn<GitPort['merge']>().mockResolvedValue({ success: true, conflicts: [] }),
    hasConflicts: jest.fn<GitPort['hasConflicts']>().mockResolvedValue(false),
    abortMerge: jest.fn<GitPort['abortMerge']>().mockResolvedValue(undefined),
    isDirty: jest.fn<GitPort['isDirty']>().mockResolvedValue(false),
    health: jest.fn<GitPort['health']>().mockResolvedValue({ ok: true }),
  };
}

function makeMockState(): StatePort {
  return {
    name: 'mock-state',
    init: jest.fn<StatePort['init']>().mockResolvedValue(undefined),
    saveTaskGraph: jest.fn<StatePort['saveTaskGraph']>().mockResolvedValue(undefined),
    loadTaskGraph: jest.fn<StatePort['loadTaskGraph']>().mockImplementation(async (goalId) => ({
      goal_id: goalId,
      version: '1.0.0',
      created_at: new Date().toISOString(),
      tasks: [],
      edges: [],
    })),
    listTaskGraphs: jest.fn<StatePort['listTaskGraphs']>().mockResolvedValue([]),
    createEvidenceLedger: jest.fn<StatePort['createEvidenceLedger']>().mockResolvedValue({ goal_id: 'g', version: '1.0.0', created_at: new Date().toISOString(), entries: [] }),
    appendEvidenceEntry: jest.fn<StatePort['appendEvidenceEntry']>().mockResolvedValue(undefined),
    saveEvidenceLedger: jest.fn<StatePort['saveEvidenceLedger']>().mockResolvedValue(undefined),
    loadEvidenceLedger: jest.fn<StatePort['loadEvidenceLedger']>().mockImplementation(async (goalId) => ({
      goal_id: goalId,
      version: '1.0.0',
      created_at: new Date().toISOString(),
      entries: [],
    })),
    saveProofArtifact: jest.fn<StatePort['saveProofArtifact']>().mockResolvedValue(undefined),
    loadProofArtifact: jest.fn<StatePort['loadProofArtifact']>().mockResolvedValue(undefined),
    listProofArtifacts: jest.fn<StatePort['listProofArtifacts']>().mockResolvedValue([]),
    saveCheckpoint: jest.fn<StatePort['saveCheckpoint']>().mockResolvedValue(undefined),
    loadCheckpoint: jest.fn<StatePort['loadCheckpoint']>().mockResolvedValue(undefined),
    listCheckpoints: jest.fn<StatePort['listCheckpoints']>().mockResolvedValue([]),
    health: jest.fn<StatePort['health']>().mockResolvedValue({ ok: true }),
  };
}

function makeMockVerifier(): VerifierPort {
  return {
    name: 'mock-verifier',
    init: jest.fn<VerifierPort['init']>().mockResolvedValue(undefined),
    runGate: jest.fn<VerifierPort['runGate']>().mockResolvedValue({ gate: 'lint', status: 'pass', command: 'cmd', exit_code: 0, output: '', duration_ms: 100 }),
    runAllGates: jest.fn<VerifierPort['runAllGates']>().mockResolvedValue([
      { gate: 'lint', status: 'pass', command: 'cmd', exit_code: 0, output: '', duration_ms: 100 },
      { gate: 'typecheck', status: 'pass', command: 'cmd', exit_code: 0, output: '', duration_ms: 100 },
      { gate: 'test', status: 'pass', command: 'cmd', exit_code: 0, output: '', duration_ms: 100 },
    ]),
    validateProofArtifact: jest.fn<VerifierPort['validateProofArtifact']>().mockResolvedValue({ valid: true, missing: [] }),
    scoreRisk: jest.fn<VerifierPort['scoreRisk']>().mockResolvedValue({ score: 10, components: {}, decision: 'auto_promote' }),
    scanDiff: jest.fn<VerifierPort['scanDiff']>().mockResolvedValue({ matches: [] }),
    health: jest.fn<VerifierPort['health']>().mockResolvedValue({ ok: true }),
  };
}

function makeMockWorker(): WorkerPort {
  return {
    name: 'mock-worker',
    init: jest.fn<WorkerPort['init']>().mockResolvedValue(undefined),
    execute: jest.fn<WorkerPort['execute']>().mockResolvedValue({ success: true, filesChanged: 2, linesAdded: 10, linesRemoved: 3 }),
    health: jest.fn<WorkerPort['health']>().mockResolvedValue({ ok: true }),
  };
}

function makeMockPlanner(): PlannerPort {
  return {
    name: 'mock-planner',
    decompose: jest.fn<PlannerPort['decompose']>().mockImplementation(async ({ goal }) => ({
      goal_id: 'test-goal',
      version: '1.0.0',
      created_at: new Date().toISOString(),
      tasks: [
        { id: 't1', level: 2, title: 'Task 1', status: 'pending', proof_requirements: [{ gate: 'lint', required: true }], input_contracts: [], output_contracts: [], estimated_minutes: 30 },
      ],
      edges: [],
    })),
    refineGraph: jest.fn<PlannerPort['refineGraph']>().mockImplementation(async (g) => g),
    generateProofRequirements: jest.fn<PlannerPort['generateProofRequirements']>().mockResolvedValue([]),
    draftContracts: jest.fn<PlannerPort['draftContracts']>().mockResolvedValue({ type_contracts: [], api_contracts: [], behavior_contracts: [], security_contracts: [] }),
    estimateEffort: jest.fn<PlannerPort['estimateEffort']>().mockResolvedValue(30),
    health: jest.fn<PlannerPort['health']>().mockResolvedValue({ ok: true }),
  };
}

const mockLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('ForgeOrchestrator', () => {
  it('executes a simple goal end-to-end', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const verifier = makeMockVerifier();
    const planner = makeMockPlanner();

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    const ledger = await orch.executeGoal('Add login feature');
    expect(ledger).toBeDefined();
    expect(ledger.entries.length).toBeGreaterThan(0);
    expect(ledger.summary?.final_status).toBe('success');
  });

  it('uses worker when provided and records file changes', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const verifier = makeMockVerifier();
    const planner = makeMockPlanner();
    const worker = makeMockWorker();

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      worker,
      logger: mockLogger,
    });

    const ledger = await orch.executeGoal('Add login feature');
    expect(ledger.summary?.final_status).toBe('success');
    expect(worker.execute).toHaveBeenCalled();
  });

  it('writes checkpoints', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const verifier = makeMockVerifier();
    const planner = makeMockPlanner();

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    // Must execute a goal first to have state
    await orch.executeGoal('Test goal');
    const checkpoint = await orch.writeCheckpoint();
    expect(checkpoint.checkpoint_id).toContain('chk');
    expect(checkpoint.goal_id).toBeDefined();
    expect(checkpoint.task_graph.hash.startsWith('sha256:')).toBe(true);
  });

  it('marks goal as failure when worker throws', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const verifier = makeMockVerifier();
    const planner = makeMockPlanner();
    const worker: WorkerPort = {
      name: 'failing-worker',
      init: jest.fn<WorkerPort['init']>().mockResolvedValue(undefined),
      execute: jest.fn<WorkerPort['execute']>().mockRejectedValue(new Error('llm down')),
      health: jest.fn<WorkerPort['health']>().mockResolvedValue({ ok: true }),
    };

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      worker,
      logger: mockLogger,
    });

    const ledger = await orch.executeGoal('Add login feature');
    expect(['failure', 'partial']).toContain(ledger.summary?.final_status);
    expect(ledger.entries.some((e) => e.type === 'task_failed')).toBe(true);
  });

  it('records failure when required gates fail', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const planner = makeMockPlanner();
    const verifier: VerifierPort = {
      ...makeMockVerifier(),
      runAllGates: jest.fn<VerifierPort['runAllGates']>().mockResolvedValue([
        { gate: 'lint', status: 'fail', command: '', exit_code: 1, output: 'lint exploded', duration_ms: 1 },
      ]),
    };

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    const ledger = await orch.executeGoal('Ship feature');
    expect(ledger.summary?.tasks_failed).toBeGreaterThanOrEqual(1);
  });

  it('rejects writeCheckpoint when no goal has been executed', async () => {
    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git: makeMockGit(),
      state: makeMockState(),
      verifier: makeMockVerifier(),
      planner: makeMockPlanner(),
      logger: mockLogger,
    });

    await expect(orch.writeCheckpoint()).rejects.toThrow(/no active goal/i);
  });

  it('commits the worktree after gates pass and records commit_sha + diff', async () => {
    const git = makeMockGit();
    (git.commit as jest.Mock<GitPort['commit']>).mockResolvedValue('abc1234');
    const state = makeMockState();
    const verifier = makeMockVerifier();
    const planner = makeMockPlanner();

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    const ledger = await orch.executeGoal('Ship feature');
    expect(ledger.summary?.final_status).toBe('success');
    expect(git.commit).toHaveBeenCalled();
    const saveCalls = (state.saveProofArtifact as jest.Mock<StatePort['saveProofArtifact']>).mock.calls;
    expect(saveCalls.length).toBeGreaterThan(0);
    const lastArtifact = saveCalls[saveCalls.length - 1][1];
    expect(lastArtifact.commit_sha).toBe('abc1234');
    expect(lastArtifact.summary?.files_changed).toBe(2); // from diffSinceBranch mock
  });

  it('writes task_failed ledger entry when required gates fail (gate name in description)', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const planner = makeMockPlanner();
    const verifier: VerifierPort = {
      ...makeMockVerifier(),
      runAllGates: jest.fn<VerifierPort['runAllGates']>().mockResolvedValue([
        { gate: 'lint', status: 'fail', command: 'eslint', exit_code: 1, output: 'lint exploded\nmore detail', duration_ms: 1 },
      ]),
    };

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    const ledger = await orch.executeGoal('Ship feature');
    const failedEntries = ledger.entries.filter((e) => e.type === 'task_failed');
    expect(failedEntries.length).toBeGreaterThanOrEqual(1);
    expect(failedEntries[0].description).toMatch(/lint/);
    expect(failedEntries[0].description).toMatch(/Required gate\(s\) failed/);
  });

  it('task_failed ledger entry includes error_code in data when gates fail', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const planner = makeMockPlanner();
    const verifier: VerifierPort = {
      ...makeMockVerifier(),
      runAllGates: jest.fn<VerifierPort['runAllGates']>().mockResolvedValue([
        { gate: 'lint', status: 'fail', command: 'eslint', exit_code: 1, output: 'broken', duration_ms: 1 },
      ]),
    };

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    const ledger = await orch.executeGoal('Ship feature');
    const failedEntries = ledger.entries.filter((e) => e.type === 'task_failed');
    expect(failedEntries.length).toBeGreaterThanOrEqual(1);
    const entry = failedEntries[0];
    expect(entry.data).toBeDefined();
    expect(entry.data?.error_code).toBe('GATES_FAILED');
  });

  it('Critical task failed log includes title and reason for level<=1 tasks', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const verifier: VerifierPort = {
      ...makeMockVerifier(),
      runAllGates: jest.fn<VerifierPort['runAllGates']>().mockResolvedValue([
        { gate: 'typecheck', status: 'fail', command: 'tsc', exit_code: 1, output: 'TS2304', duration_ms: 1 },
      ]),
    };
    const planner: PlannerPort = {
      ...makeMockPlanner(),
      decompose: jest.fn<PlannerPort['decompose']>().mockResolvedValue({
        goal_id: 'critical-goal',
        version: '1.0.0',
        created_at: new Date().toISOString(),
        tasks: [
          {
            id: 't-critical',
            level: 1,
            title: 'Critical migration task',
            status: 'pending',
            proof_requirements: [{ gate: 'typecheck', required: true }],
            input_contracts: [],
            output_contracts: [],
            estimated_minutes: 30,
          },
        ],
        edges: [],
      }),
    };

    const errorSpy = jest.fn();
    const logger: Logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: errorSpy,
      debug: jest.fn(),
    };

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger,
    });

    await orch.executeGoal('Critical work');
    const criticalCall = errorSpy.mock.calls.find(
      (c) => c[0] === 'Critical task failed, aborting goal'
    );
    expect(criticalCall).toBeDefined();
    const meta = criticalCall?.[1] as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.title).toBe('Critical migration task');
    expect(meta.level).toBe(1);
    expect(meta.reason).toMatch(/typecheck/);
  });

  it('marks the task as failed AND records task_failed entry if commit fails after gates pass', async () => {
    const git = makeMockGit();
    (git.commit as jest.Mock<GitPort['commit']>).mockRejectedValue(new Error('commit refused'));
    const state = makeMockState();
    const verifier = makeMockVerifier();
    const planner = makeMockPlanner();

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    const ledger = await orch.executeGoal('Ship feature');
    expect(ledger.summary?.tasks_failed).toBeGreaterThanOrEqual(1);
    const failedEntries = ledger.entries.filter((e) => e.type === 'task_failed');
    expect(failedEntries.length).toBeGreaterThanOrEqual(1);
    expect(failedEntries[0].description).toMatch(/commit/i);
  });

  it('executeTaskInternal persists proof artifact even when gates fail', async () => {
    // Planner mock makes a task with required gate `lint`. A mixed
    // pass/fail set means allRequiredPass is false, so we hit the
    // failure branch — the regression we are fixing was that the
    // artifact built in that branch was never persisted.
    const git = makeMockGit();
    const state = makeMockState();
    const planner = makeMockPlanner();
    const verifier: VerifierPort = {
      ...makeMockVerifier(),
      runAllGates: jest.fn<VerifierPort['runAllGates']>().mockResolvedValue([
        { gate: 'lint', status: 'fail', command: 'lint', exit_code: 1, output: 'boom', duration_ms: 1 },
        { gate: 'typecheck', status: 'pass', command: 'tsc', exit_code: 0, output: '', duration_ms: 1 },
      ]),
    };

    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    await orch.executeGoal('Ship feature');

    const saveCalls = (state.saveProofArtifact as jest.Mock<StatePort['saveProofArtifact']>).mock.calls;
    expect(saveCalls.length).toBe(1);
    const savedArtifact = saveCalls[0][1];
    expect(savedArtifact.all_pass).toBe(false);
    expect(savedArtifact.failed_gates).toEqual(expect.arrayContaining(['lint']));
    expect(savedArtifact.failed_gates).not.toContain('typecheck');
    // Sanity: the success-path commit step must not have run.
    expect(git.commit).not.toHaveBeenCalled();
  });

  it('executeTaskInternal preserves worktree when preserve_worktree_on_failure is true', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const planner = makeMockPlanner();
    const verifier: VerifierPort = {
      ...makeMockVerifier(),
      runAllGates: jest.fn<VerifierPort['runAllGates']>().mockResolvedValue([
        { gate: 'lint', status: 'fail', command: 'lint', exit_code: 1, output: 'boom', duration_ms: 1 },
      ]),
    };
    const config = makeMockConfig();
    const configWithPreserve: ForgeConfig = {
      ...config,
      git: { ...config.git, preserve_worktree_on_failure: true },
    };

    const orch = new ForgeOrchestrator({
      config: configWithPreserve,
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    await orch.executeGoal('Ship feature');

    expect(git.destroyWorktree).not.toHaveBeenCalled();
    // Artifact is still persisted on the failure path.
    expect(state.saveProofArtifact).toHaveBeenCalledTimes(1);
  });

  it('executeTaskInternal still destroys worktree when preserve flag is false (default)', async () => {
    const git = makeMockGit();
    const state = makeMockState();
    const planner = makeMockPlanner();
    const verifier: VerifierPort = {
      ...makeMockVerifier(),
      runAllGates: jest.fn<VerifierPort['runAllGates']>().mockResolvedValue([
        { gate: 'lint', status: 'fail', command: 'lint', exit_code: 1, output: 'boom', duration_ms: 1 },
      ]),
    };

    // makeMockConfig() defaults preserve_worktree_on_failure: false
    const orch = new ForgeOrchestrator({
      config: makeMockConfig(),
      git,
      state,
      verifier,
      planner,
      logger: mockLogger,
    });

    await orch.executeGoal('Ship feature');

    expect(git.destroyWorktree).toHaveBeenCalledTimes(1);
  });
});
