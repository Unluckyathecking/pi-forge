import { describe, it, expect } from '@jest/globals';
import { slugify, generateId, isDefined, pMap, delay } from '../../src/utils/helpers.js';

describe('helpers', () => {
  describe('slugify', () => {
    it('converts text to kebab-case', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('trims to 50 chars', () => {
      const long = 'a'.repeat(100);
      expect(slugify(long).length).toBe(50);
    });

    it('handles special characters', () => {
      expect(slugify('Auth / Login!')).toBe('auth-login');
    });
  });

  describe('generateId', () => {
    it('generates unique ids', () => {
      const a = generateId();
      const b = generateId();
      expect(a).not.toBe(b);
      expect(a.length).toBeGreaterThan(10);
    });

    it('includes prefix when given', () => {
      const id = generateId('test');
      expect(id.startsWith('test-')).toBe(true);
    });
  });

  describe('isDefined', () => {
    it('returns true for defined values', () => {
      expect(isDefined(0)).toBe(true);
      expect(isDefined('')).toBe(true);
      expect(isDefined(false)).toBe(true);
    });

    it('returns false for null and undefined', () => {
      expect(isDefined(null)).toBe(false);
      expect(isDefined(undefined)).toBe(false);
    });
  });
});

describe('pMap', () => {
  it('maps correctly with concurrency limit', async () => {
    const arr = [1, 2, 3, 4, 5];
    const inflight = new Set();
    let maxInflight = 0;

    const mapped = await pMap(arr, async (val) => {
      inflight.add(val);
      maxInflight = Math.max(maxInflight, inflight.size);
      await delay(10);
      inflight.delete(val);
      return val * 2;
    }, { concurrency: 2 });

    expect(mapped).toEqual([2, 4, 6, 8, 10]);
    expect(maxInflight).toBeLessThanOrEqual(2);
  });

  it('handles empty arrays', async () => {
    const mapped = await pMap([], async (val) => val, { concurrency: 2 });
    expect(mapped).toEqual([]);
  });

  it('handles concurrency 0', async () => {
    const mapped = await pMap([1, 2], async (val) => val, { concurrency: 0 });
    expect(mapped).toEqual([]);
  });

  it('preserves order even with sparse resolution times', async () => {
    const arr = [1, 2, 3];
    const mapped = await pMap(arr, async (val) => {
      if (val === 1) await delay(30);
      if (val === 2) await delay(10);
      if (val === 3) await delay(20);
      return val * 2;
    }, { concurrency: 3 });
    expect(mapped).toEqual([2, 4, 6]);
  });

  it('handles synchronous mappers', async () => {
    const mapped = await pMap([1, 2, 3], (val) => val * 2, { concurrency: 2 });
    expect(mapped).toEqual([2, 4, 6]);
  });

  it('stops processing on error and rejects correctly', async () => {
    let processed = 0;
    const p = pMap([1, 2, 3, 4], async (val) => {
      processed++;
      if (val === 2) throw new Error('fail');
      await delay(10);
      return val;
    }, { concurrency: 1 });
    await expect(p).rejects.toThrow('fail');
    expect(processed).toBe(2);
  });

  it('handles synchronous throw in iterator', async () => {
    const iterable = {
      [Symbol.iterator]() {
        let i = 0;
        return {
          next() {
            if (i === 1) throw new Error('iterator fail');
            i++;
            return { value: i, done: false };
          }
        };
      }
    };

    const p = pMap(iterable, async (val) => val, { concurrency: 1 });
    await expect(p).rejects.toThrow('iterator fail');
  });

  it('passes index to mapper', async () => {
    const indices: number[] = [];
    await pMap(['a', 'b', 'c'], async (val, idx) => {
      indices.push(idx);
    }, { concurrency: 2 });
    expect(indices).toEqual([0, 1, 2]);
  });

  it('rejects on synchronous throw from mapper', async () => {
    const p = pMap([1, 2], (val) => {
      if (val === 2) throw new Error('sync fail');
      return val;
    }, { concurrency: 1 });
    await expect(p).rejects.toThrow('sync fail');
  });

  it('calls iterator.return on early error', async () => {
    let returned = false;
    const iterable = {
      [Symbol.iterator]() {
        let i = 0;
        return {
          next() {
            if (i >= 3) return { done: true, value: undefined };
            i++;
            return { value: i, done: false };
          },
          return() {
            returned = true;
            return { done: true, value: undefined };
          }
        };
      }
    };
    const p = pMap(iterable, async (val) => {
      if (val === 2) throw new Error('abort');
      return val;
    }, { concurrency: 1 });
    await expect(p).rejects.toThrow('abort');
    expect(returned).toBe(true);
  });
});
