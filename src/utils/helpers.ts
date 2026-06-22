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
  const iterator = iterable[Symbol.iterator]() as Iterator<T, unknown, undefined>;

  const results: R[] = [];

  if (options.concurrency <= 0) {
    return [];
  }

  return new Promise<R[]>((resolve, reject) => {
    let index = 0;
    let startedCount = 0;
    let settledCount = 0;
    let hasError = false;
    let isDone = false;

    function checkDone(): void {
      if (!hasError && isDone && startedCount === settledCount) {
        resolve(results);
      }
    }

    function startNext(): void {
      if (hasError) return;

      let next;
      try {
        next = iterator.next();
      } catch (e) {
        hasError = true;
        if (iterator.return) {
           try {
             iterator.return();
           } catch {
             // ignore
           }
        }
        return reject(e);
      }

      if (next.done) {
        isDone = true;
        checkDone();
        return;
      }

      const currentIndex = index++;
      const item = next.value;
      startedCount++;

      new Promise<R>((res) => res(mapper(item, currentIndex)))
        .then(
          (result) => {
            if (hasError) return;
            results[currentIndex] = result;
            settledCount++;
            startNext();
            checkDone();
          },
          (e) => {
            if (hasError) return;
            hasError = true;
            if (iterator.return) {
               try {
                 iterator.return();
               } catch {
                 // ignore
               }
            }
            reject(e);
          }
        );
    }

    // Determine initial count
    let initialCount = options.concurrency;
    if (Array.isArray(iterable)) {
      initialCount = Math.min(options.concurrency, iterable.length);
    }

    if (initialCount === 0) {
      resolve([]);
      return;
    }

    for (let i = 0; i < initialCount; i++) {
      startNext();
    }
  });
}
