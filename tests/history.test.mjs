import assert from "node:assert/strict";
import { test } from "node:test";
import { collectHistoryPage } from "../worker/history.js";

const summarize = (message) => ({ id: message.id, text: message.message });

async function* history(beforeId) {
  for (const id of [5, 4, 3, 2, 1]) {
    if (!beforeId || id < beforeId) yield { id, message: `message ${id}` };
  }
}

test("history cursor resumes without duplicates or missing messages", async () => {
  const first = await collectHistoryPage(history(), summarize, 2);
  assert.deepEqual(first.messages.map((message) => message.id), [5, 4]);
  assert.equal(first.has_more, true);
  assert.equal(first.next_before_message_id, 4);

  const second = await collectHistoryPage(history(first.next_before_message_id), summarize, 2, first.next_before_message_id);
  assert.deepEqual(second.messages.map((message) => message.id), [3, 2]);
  assert.equal(second.next_before_message_id, 2);

  const last = await collectHistoryPage(history(second.next_before_message_id), summarize, 2, second.next_before_message_id);
  assert.deepEqual(last.messages.map((message) => message.id), [1]);
  assert.equal(last.has_more, false);
  assert.equal(last.next_before_message_id, null);
});

test("history stops at its response budget and returns a continuation", async () => {
  const result = await collectHistoryPage(history(), summarize, 5, undefined, 50);
  assert.deepEqual(result.messages.map((message) => message.id), [5]);
  assert.equal(result.has_more, true);
  assert.equal(result.next_before_message_id, 5);
});
