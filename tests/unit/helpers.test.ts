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

  it('handles errors', async () => {
    const p = pMap([1, 2, 3], async (val) => {
      if (val === 2) throw new Error('fail');
      return val;
    }, { concurrency: 2 });
    await expect(p).rejects.toThrow('fail');
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
});
