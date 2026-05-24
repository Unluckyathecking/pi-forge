import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimplePlannerAdapter } from '../../src/adapters/planner.js';
import type { Task } from '../../src/core/types.js';

describe('SimplePlannerAdapter', () => {
  const planner = new SimplePlannerAdapter();

  it('decomposes a feature goal into tasks', async () => {
    const graph = await planner.decompose({ goal: 'Add user authentication' });
    expect(graph.tasks.length).toBeGreaterThanOrEqual(1);
    expect(graph.goal_id).toContain('add-user-authentication');
    expect(graph.version).toBe('1.0.0');
  });

  it('creates a fix-oriented graph for bug goals', async () => {
    const graph = await planner.decompose({ goal: 'Fix login bug' });
    const titles = graph.tasks.map((t) => t.title.toLowerCase());
    expect(titles.some((t) => t.includes('reproduce') || t.includes('fix'))).toBe(true);
  });

  it('generates proof requirements per level', async () => {
    const reqs = await planner.generateProofRequirements({
      id: 't1',
      level: 1,
      title: 'feature',
      status: 'pending',
      proof_requirements: [],
      input_contracts: [],
      output_contracts: [],
      estimated_minutes: 60,
    });
    const gates = reqs.map((r) => r.gate);
    expect(gates).toContain('lint');
    expect(gates).toContain('typecheck');
    expect(gates).toContain('test');
  });

  it('estimates effort based on level', async () => {
    const l0 = await planner.estimateEffort({
      id: 't', level: 0, title: 'x', status: 'pending',
      proof_requirements: [], input_contracts: [], output_contracts: [], estimated_minutes: 0,
    });
    const l3 = await planner.estimateEffort({
      id: 't', level: 3, title: 'x', status: 'pending',
      proof_requirements: [], input_contracts: [], output_contracts: [], estimated_minutes: 0,
    });
    expect(l0).toBeGreaterThan(l3);
  });

  it('reports healthy', async () => {
    const h = await planner.health();
    expect(h.ok).toBe(true);
  });

  it('emits refactor branch for refactor goals', async () => {
    const graph = await planner.decompose({ goal: 'Refactor auth module' });
    const titles = graph.tasks.map((t) => t.title.toLowerCase());
    expect(titles.some((t) => t.includes('refactor'))).toBe(true);
  });

  it('refineGraph appends a follow-up task linked to the last task', async () => {
    const base = await planner.decompose({ goal: 'Add caching' });
    const refined = await planner.refineGraph(base, 'Address latency edge case in stale eviction');
    expect(refined.tasks.length).toBe(base.tasks.length + 1);
    const last = refined.tasks[refined.tasks.length - 1];
    expect(last.description).toContain('latency edge case');
    expect(refined.edges.some((e) => e.to === last.id)).toBe(true);
  });

  it('falls back to a single task when maxDepth is 0', async () => {
    const graph = await planner.decompose({ goal: 'Document the API', constraints: { max_depth: 0 } });
    expect(graph.tasks).toHaveLength(1);
  });

  it('adds security_scan and build requirements for L0 and L1 tasks', async () => {
    const reqs = await planner.generateProofRequirements({
      id: 't', level: 0, title: 'project', status: 'pending',
      proof_requirements: [], input_contracts: [], output_contracts: [], estimated_minutes: 600,
    } as Task);
    const gates = reqs.map((r) => r.gate);
    expect(gates).toContain('build');
    expect(gates).toContain('security_scan');
  });

  describe('PLAN.md detection', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'pi-forge-planner-'));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('decompose with PLAN.md detection emits 2-task DAG', async () => {
      await writeFile(join(tmpDir, 'PLAN.md'), '# Plan\n\nSteps to ship the feature.\n', 'utf-8');

      const graph = await planner.decompose({
        goal: 'Execute PLAN.md',
        projectRoot: tmpDir,
      });

      const ids = graph.tasks.map((t) => t.id);
      expect(ids).toEqual(['implement', 'verify']);
    });

    it('decompose without PLAN.md emits legacy 3-task feature DAG', async () => {
      // tmpDir has no PLAN.md file even though the goal mentions it.
      const graph = await planner.decompose({
        goal: 'Execute PLAN.md',
        projectRoot: tmpDir,
      });

      const ids = graph.tasks.map((t) => t.id);
      expect(ids).toEqual(['plan', 'implement', 'test']);
    });

    it('decompose ignores PLAN.md detection when goal text does not reference it', async () => {
      // PLAN.md exists in projectRoot, but the goal never mentions it.
      await writeFile(join(tmpDir, 'PLAN.md'), '# Plan\n\nIrrelevant here.\n', 'utf-8');

      const graph = await planner.decompose({
        goal: 'Add a feature for users',
        projectRoot: tmpDir,
      });

      const ids = graph.tasks.map((t) => t.id);
      expect(ids).toEqual(['plan', 'implement', 'test']);
    });
  });

  describe('--tasks filter', () => {
    it('decompose with tasks filter returns only matching tasks', async () => {
      const graph = await planner.decompose({
        goal: 'Add user authentication',
        tasks: ['implement'],
      });

      expect(graph.tasks).toHaveLength(1);
      expect(graph.tasks[0].id).toBe('implement');
    });

    it('decompose with tasks filter preserves declared order', async () => {
      // Request order is ['test', 'plan'] but planner produced order is
      // ['plan', 'implement', 'test']. The filtered output must follow the
      // planner's order (plan then test), NOT the request order.
      const graph = await planner.decompose({
        goal: 'Add user authentication',
        tasks: ['test', 'plan'],
      });

      const ids = graph.tasks.map((t) => t.id);
      expect(ids).toEqual(['plan', 'test']);
    });

    it('decompose with empty tasks array uses full decomposition', async () => {
      const graph = await planner.decompose({
        goal: 'Add user authentication',
        tasks: [],
      });

      const ids = graph.tasks.map((t) => t.id);
      expect(ids).toEqual(['plan', 'implement', 'test']);
    });
  });
});
