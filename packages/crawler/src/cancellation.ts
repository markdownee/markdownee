/**
 * Cancellation for a request handler the crawler has already given up on.
 *
 * Crawlee applies `requestHandlerTimeoutSecs` by racing the handler against a
 * timer and rejecting the promise it wrapped the handler in. It does not
 * interrupt the handler: every `await` still in flight resolves in its own time
 * and the code after it runs. A handler whose budget expired mid-discovery was
 * measured fetching an advertised alternate seconds later and writing its record
 * after `crawler.run()` had already resolved, so one URL produced both a failed
 * record and a success record.
 *
 * Crawlee's own answer is `tryCancel()` from `@apify/timeout`, and it is not
 * usable here. Two independent traps make it silent rather than wrong:
 *
 * 1. It is not exported from `crawlee` or `@crawlee/core`, and more than one
 *    copy of `@apify/timeout` is installed. The store `tryCancel` reads is a
 *    module-level `AsyncLocalStorage`, so only the copy resolved by
 *    `@crawlee/basic` — the package that applies the handler timeout — can see
 *    the handler's own cancellation. That resolution moved from 0.4.8 to 0.4.11
 *    within a day of being measured, so a pinned direct dependency is a no-op
 *    waiting to happen.
 * 2. The package ships separate ESM and CJS builds with a module-level store
 *    each (`cjs.storage === esm.storage` is false). This package is ESM, so a
 *    plain `import` resolves the ESM build, whose `tryCancel()` never sees the
 *    store that `@crawlee/basic` — CommonJS — armed. Measured: it returns
 *    silently while the CJS `tryCancel()` throws.
 *
 * So cancellation is driven from Crawlee's public surface instead. `context.id`
 * is minted fresh per handler run and the adaptive crawler forwards the outer
 * one into the sub-contexts it hands the handler, so it identifies exactly one
 * run of one request. `errorHandler` and `failedRequestHandler` are public
 * options that Crawlee calls — exactly one of them, with that same context —
 * immediately after the timeout rejection. Marking the run there inherits
 * Crawlee's own clock without depending on anything internal to it.
 */

/**
 * Thrown out of a handler whose request the crawler already failed. The throw is
 * absorbed: the promise Crawlee raced has already settled by the time a handler
 * can observe its own cancellation, and rejecting a settled promise is a no-op.
 */
export class HandlerCancelledError extends Error {
  constructor(url: string) {
    super(`Stopping the remaining handler work for failed request: ${url}`);
    this.name = 'HandlerCancelledError';
  }
}

/** The live and cancelled handler runs of one crawler, keyed by `context.id`. */
export class RunCancellation {
  /**
   * Runs whose handler is between entry and return. `cancel` marks only these,
   * which is what bounds this state to the crawler's concurrency: a failure
   * reported after its handler had already returned — a request that failed
   * while being marked handled, say — has nothing left to cancel and is
   * therefore not remembered.
   */
  private readonly live = new Set<string>();

  /**
   * Runs the crawler has failed. A mark is NOT released when its handler
   * returns, because one `context.id` can cover more than one handler run: the
   * adaptive crawler runs the HTTP-only handler, and on any error — its
   * `shouldPropagateError` defaults to `() => false`, so every error qualifies —
   * falls through to a browser rerun under the same id, inside the same already
   * rejected task. Releasing the mark on the first run's exit would let that
   * rerun write the record the first run was stopped from writing.
   */
  private readonly cancelled = new Set<string>();

  /**
   * Cancelled runs remembered at once. The set only ever grows by one per failed
   * request, but a long crawl's failure count is input-controlled, so the oldest
   * mark is dropped at the cap — matching how `OriginProbeBudget` bounds
   * its own per-origin map. Eviction costs an id nothing: `finish` has already
   * released it from {@link live}, and the request it belonged to is over.
   */
  private static readonly MAX_CANCELLED = 10_000;

  /** Register a handler run. Called once, at handler entry. */
  begin(runId: string): void {
    this.live.add(runId);
  }

  /**
   * Mark a run's request as failed by the crawler.
   *
   * Must never throw. Crawlee wraps its `errorHandler`/`failedRequestHandler`
   * calls in `_tagUserHandlerError`, and an exception raised there becomes a
   * secondary error that terminates the whole crawl.
   */
  cancel(runId: string | undefined): void {
    if (typeof runId !== 'string' || !this.live.has(runId)) return;
    if (!this.cancelled.has(runId) && this.cancelled.size >= RunCancellation.MAX_CANCELLED) {
      const oldest = this.cancelled.keys().next();
      if (!oldest.done) this.cancelled.delete(oldest.value);
    }
    this.cancelled.add(runId);
  }

  /**
   * Release a handler run. Called from the handler's `finally`. The run stops
   * being cancellable; a mark it already carries stays, for the reason
   * {@link cancelled} gives.
   */
  finish(runId: string): void {
    this.live.delete(runId);
  }

  /** Abandon this run when its request has already failed. */
  throwIfCancelled(runId: string, url: string): void {
    if (!this.cancelled.has(runId)) return;
    throw new HandlerCancelledError(url);
  }
}

/**
 * Wrap a request handler so its run is registered for the whole of its body.
 *
 * Returns the handler unchanged when no cancellation is configured, which keeps
 * a handler built directly — as the co-located tests build them, from contexts
 * that carry no crawler — exactly as it was.
 */
export function withRunCancellation<Context extends { id: string }>(
  cancellation: RunCancellation | undefined,
  handler: (context: Context) => Promise<void>,
): (context: Context) => Promise<void> {
  if (cancellation === undefined) return handler;
  return async (context: Context): Promise<void> => {
    cancellation.begin(context.id);
    try {
      await handler(context);
    } finally {
      cancellation.finish(context.id);
    }
  };
}
