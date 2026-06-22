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
  mapper: (item: T, index: number) => Promise<R> | R,
  options: { concurrency: number }
): Promise<R[]> {
  if (options.concurrency <= 0) {
    return [];
  }

  // Convert to array upfront so we know the length and can pre-allocate results.
  const items = Array.from(iterable);
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  const initialCount = Math.min(options.concurrency, items.length);

  return new Promise<R[]>((resolve, reject) => {
    let index = 0;
    let settledCount = 0;
    let hasError = false;

    function checkDone(): void {
      if (!hasError && settledCount === items.length) {
        resolve(results);
      }
    }

    function startNext(): void {
      if (hasError) return;
      if (index >= items.length) {
        checkDone();
        return;
      }

      const currentIndex = index++;
      const item = items[currentIndex];

      new Promise<R>((res) => res(mapper(item, currentIndex)))
        .then(
          (result) => {
            if (hasError) return;
            results[currentIndex] = result;
            settledCount++;
            startNext();
          },
          (e) => {
            if (hasError) return;
            hasError = true;
            reject(e);
          }
        );
    }

    for (let i = 0; i < initialCount; i++) {
      startNext();
    }
  });
}
