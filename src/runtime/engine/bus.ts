// createBus<T> — minimal pub/sub + async-iterator over native Set + Promise.
// No event-library deps.

const DEFAULT_QUEUE_CAP = 1024;

export interface Bus<T> {
  subscribe(handler: (ev: T) => void): () => void;
  dispatch(ev: T): void;
  iterate(): AsyncIterable<T>;
}

type IteratorState<T> = {
  queue: T[];
  pending: Array<(value: IteratorResult<T>) => void>;
  closed: boolean;
};

export function createBus<T>(options: { queueCap?: number } = {}): Bus<T> {
  const cap = options.queueCap ?? DEFAULT_QUEUE_CAP;
  const handlers = new Set<(ev: T) => void>();
  const iterators = new Set<IteratorState<T>>();

  function dispatch(ev: T): void {
    for (const h of handlers) {
      try {
        h(ev);
      } catch {
        // Per spec: subscriber-thrown errors must not crash the bus.
      }
    }
    for (const it of iterators) {
      pushIntoIterator(it, ev, cap);
    }
  }

  function subscribe(handler: (ev: T) => void): () => void {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  function iterate(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]() {
        const it: IteratorState<T> = { queue: [], pending: [], closed: false };
        iterators.add(it);
        return {
          next(): Promise<IteratorResult<T>> {
            if (it.closed) {
              return Promise.resolve({ value: undefined as unknown as T, done: true });
            }
            if (it.queue.length > 0) {
              return Promise.resolve({ value: it.queue.shift() as T, done: false });
            }
            return new Promise<IteratorResult<T>>((resolve) => {
              it.pending.push(resolve);
            });
          },
          return(): Promise<IteratorResult<T>> {
            it.closed = true;
            iterators.delete(it);
            for (const resolve of it.pending) {
              resolve({ value: undefined as unknown as T, done: true });
            }
            it.pending.length = 0;
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          },
        };
      },
    };
  }

  return { subscribe, dispatch, iterate };
}

function pushIntoIterator<T>(it: IteratorState<T>, ev: T, cap: number): void {
  if (it.pending.length > 0) {
    const resolve = it.pending.shift();
    resolve?.({ value: ev, done: false });
    return;
  }
  if (it.queue.length >= cap) {
    it.queue.shift();
    console.warn(`acpx bus: dropped oldest event (queue cap ${cap} exceeded)`);
  }
  it.queue.push(ev);
}
