/**
 * Runs tasks one at a time with at least `gapMs` between their starts (Nominatim: 1 per
 * second). A failed task doesn't hold up the next one.
 */
export function rateLimit(gapMs: number, now: () => number = () => Date.now()) {
  let chain: Promise<unknown> = Promise.resolve();
  let last = -Infinity;
  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = last + gapMs - now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = now();
      return task();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}
