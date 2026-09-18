interface PendingWrites {
  readonly add: (write: Promise<unknown>) => void;
  readonly drain: () => Promise<void>;
}

/** Track storage writes started by synchronous crawler callbacks until run cleanup. */
export function createPendingWrites(): PendingWrites {
  const pending = new Set<Promise<void>>();
  let failure: { readonly error: unknown } | undefined;
  return {
    add(write) {
      const tracked = write.then(
        () => {
          pending.delete(tracked);
        },
        (error: unknown) => {
          failure ??= { error };
          pending.delete(tracked);
        },
      );
      pending.add(tracked);
    },
    async drain() {
      await Promise.all(pending);
      if (failure !== undefined) throw failure.error;
    },
  };
}
