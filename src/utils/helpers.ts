/**
 * Shared utilities for Pi Forge
 */

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

export function generateId(prefix?: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  const ts = Date.now().toString(36);
  return prefix ? `${prefix}-${ts}-${rand}` : `${ts}-${rand}`;
}

export function formatDate(date: Date = new Date()): string {
  return date.toISOString();
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDefined<T>(value: T | undefined | null): value is T {
  return value != null;
}

/**
 * Returns the value of the last element in the array where predicate is true, and undefined
 * otherwise.
 * ⚡ Bolt Optimization: Provides an O(1) space alternative to [...arr].reverse().find()
 */
export function findLast<T>(arr: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) {
      return arr[i];
    }
  }
  return undefined;
}
