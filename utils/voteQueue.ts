export type Vote = -1 | 0 | 1;

export function createVoteQueue(
  initial: Vote,
  send: (vote: Vote) => Promise<unknown>,
  update: (vote: Vote) => void,
  failed: () => void,
  settled: () => void,
) {
  let confirmed = initial;
  let desired = initial;
  let running = false;
  let retired = false;
  let lastTap = 0;

  async function synchronize() {
    running = true;
    try {
      while (!retired && confirmed !== desired) {
        const requested = desired;
        await send(requested);
        confirmed = requested;
      }
    } catch {
      // Avoid flashing back immediately on fast failures; do not retry queued votes.
      const delay = Math.max(0, 250 - (Date.now() - lastTap));
      if (!retired && delay)
        await new Promise((resolve) => setTimeout(resolve, delay));
      if (!retired) failed();
    } finally {
      desired = confirmed;
      update(confirmed);
      running = false;
      settled();
    }
  }

  return {
    press(direction: Vote) {
      if (retired) return;
      desired = desired === direction ? 0 : direction;
      lastTap = Date.now();
      update(desired);
      if (!running) void synchronize();
    },
    retire() {
      retired = true;
      // The current request may still succeed, but unsent choices must not linger.
      update(confirmed);
    },
  };
}

/** A recycled row reuses its pending operation when it returns to the same post. */
export function createVoteQueues() {
  const queues = new Map<string, ReturnType<typeof createVoteQueue>>();
  return {
    get(
      key: string,
      create: (settled: () => void) => ReturnType<typeof createVoteQueue>,
    ) {
      let queue = queues.get(key);
      if (!queue) {
        queue = create(() => {
          if (queues.get(key) === queue) queues.delete(key);
        });
        queues.set(key, queue);
      }
      return queue;
    },
    retire() {
      for (const queue of queues.values()) queue.retire();
      queues.clear();
    },
  };
}
