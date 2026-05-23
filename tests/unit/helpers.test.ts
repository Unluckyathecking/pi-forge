import { describe, it, expect } from '@jest/globals';
import { slugify, generateId, isDefined } from '../../src/utils/helpers.js';

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
