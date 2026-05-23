import { describe, it, expect } from '@jest/globals';
import { SimplePlannerAdapter } from '../../src/adapters/planner.js';

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
});
