import assert from "node:assert/strict";
import { test } from "node:test";

import { SignalStore, validateNewSignal } from "./store.js";

test("adds and lists signals newest-first", () => {
  const store = new SignalStore();
  const first = store.add({ author: "ada", message: "hello" });
  const second = store.add({ author: "grace", message: "world" });

  const list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, second.id);
  assert.equal(list[1].id, first.id);
});

test("trims whitespace on insert", () => {
  const store = new SignalStore();
  const signal = store.add({ author: "  ada  ", message: "  hi  " });
  assert.equal(signal.author, "ada");
  assert.equal(signal.message, "hi");
});

test("removes signals by id", () => {
  const store = new SignalStore();
  const signal = store.add({ author: "ada", message: "hello" });
  assert.equal(store.remove(signal.id), true);
  assert.equal(store.remove(signal.id), false);
  assert.equal(store.list().length, 0);
});

test("rejects invalid payloads", () => {
  assert.equal(validateNewSignal(null), null);
  assert.equal(validateNewSignal({ author: "ada" }), null);
  assert.equal(validateNewSignal({ message: "hi" }), null);
  assert.equal(validateNewSignal({ author: "", message: "hi" }), null);
  assert.equal(validateNewSignal({ author: "ada", message: "x".repeat(281) }), null);
});

test("accepts valid payloads", () => {
  const parsed = validateNewSignal({ author: "ada", message: "hi" });
  assert.deepEqual(parsed, { author: "ada", message: "hi" });
});
