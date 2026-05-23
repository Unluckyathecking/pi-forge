import { describe, it, expect } from '@jest/globals';
import type { WorkerPort, WorkerResult } from '../../src/ports/worker.js';

describe('WorkerPort interface', () => {
  it('can be implemented by a mock worker', async () => {
    const mockWorker: WorkerPort = {
      name: 'mock-worker',
      init: async () => {},
      execute: async () =>
        ({ success: true, filesChanged: 2, linesAdded: 10, linesRemoved: 3 }) as WorkerResult,
      health: async () => ({ ok: true }),
    };

    await mockWorker.init({ projectRoot: '/tmp' });
    const result = await mockWorker.execute(
      {
        id: 't1',
        level: 2,
        title: 'Mock task',
        status: 'pending',
        proof_requirements: [],
        input_contracts: [],
        output_contracts: [],
        estimated_minutes: 30,
      },
      '/tmp/wt'
    );

    expect(result.success).toBe(true);
    expect(result.filesChanged).toBe(2);
  });
});
