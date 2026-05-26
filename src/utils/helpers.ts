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
  return value !== undefined && value !== null;
}

/**
 * Executes a mapping function concurrently with a concurrency limit.
 */
export async function pMap<T, R>(
  iterable: Iterable<T>,
  mapper: (item: T, index: number) => Promise<R>,
  options: { concurrency: number }
): Promise<R[]> {
  const iterator = iterable[Symbol.iterator]();
  const results: R[] = [];
  const promises = new Set<Promise<void>>();
  let index = 0;
  let hasError = false;

  return new Promise<R[]>((resolve, reject) => {
    function startNext(): void {
      if (hasError) return;

      let next;
      try {
        next = iterator.next();
      } catch (e) {
        hasError = true;

        return reject(e);
      }

      if (next.done) {
        if (promises.size === 0) {
          resolve(results);
        }
        return;
      }

      const currentIndex = index++;
      const item = next.value;

      const p = Promise.resolve().then(() => mapper(item, currentIndex))
        .then((result) => {
          results[currentIndex] = result;
          promises.delete(p);
          startNext();
        })
        .catch((e) => {
          hasError = true;

          reject(e);
        });

      promises.add(p);
    }

    const initialCount = Math.min(options.concurrency, Array.isArray(iterable) ? iterable.length : options.concurrency);
    if (initialCount === 0) {
       resolve(results);
       return;
    }
    for (let i = 0; i < initialCount; i++) {
      startNext();
    }
  });
}
