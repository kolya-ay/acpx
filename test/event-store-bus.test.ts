import { strict as assert } from "node:assert";
import test from "node:test";
import { createBus } from "../src/runtime/engine/bus.js";

test("subscribe and dispatch deliver event to handler", () => {
  const bus = createBus<number>();
  let last = 0;
  bus.subscribe((n) => {
    last = n;
  });
  bus.dispatch(1);
  assert.equal(last, 1);
});

test("unsubscribe stops future dispatches", () => {
  const bus = createBus<number>();
  let last = 0;
  const off = bus.subscribe((n) => {
    last = n;
  });
  bus.dispatch(1);
  off();
  bus.dispatch(99);
  assert.equal(last, 1);
});

test("a throwing subscriber does not crash the bus", () => {
  const bus = createBus<number>();
  let count = 0;
  bus.subscribe(() => {
    throw new Error("boom");
  });
  bus.subscribe(() => {
    count++;
  });
  bus.dispatch(1);
  bus.dispatch(2);
  assert.equal(count, 2);
});

test("iterate() yields dispatched events in order", async () => {
  const bus = createBus<number>();
  const it = bus.iterate()[Symbol.asyncIterator]();
  bus.dispatch(1);
  bus.dispatch(2);
  bus.dispatch(3);
  assert.deepEqual(await it.next(), { value: 1, done: false });
  assert.deepEqual(await it.next(), { value: 2, done: false });
  assert.deepEqual(await it.next(), { value: 3, done: false });
  if (it.return) {
    await it.return();
  }
});

test("iterate() with queueCap drops oldest when overflowed", async () => {
  const bus = createBus<number>({ queueCap: 2 });
  // First iterator collects events into its own queue but is never drained.
  bus.iterate()[Symbol.asyncIterator]();
  bus.dispatch(1);
  bus.dispatch(2);
  bus.dispatch(3); // drops 1 from first iterator's queue
  bus.dispatch(4); // drops 2 from first iterator's queue
  // Second iterator starts fresh (separate queue state).
  const it = bus.iterate()[Symbol.asyncIterator]();
  bus.dispatch(5);
  assert.deepEqual(await it.next(), { value: 5, done: false });
  if (it.return) {
    await it.return();
  }
});

test("iterate() return() drains pending promises with done:true", async () => {
  const bus = createBus<number>();
  const it = bus.iterate()[Symbol.asyncIterator]();
  const next = it.next();
  if (it.return) {
    await it.return();
  }
  const result = await next;
  assert.equal(result.done, true);
});
