import test from "node:test";
import assert from "node:assert/strict";

import { consumeRateLimit, resetRateLimits } from "../lib/rate-limit.ts";

test("allows a burst up to capacity then refuses", () => {
  resetRateLimits();
  const now = Date.now();
  for (let i = 0; i < 6; i += 1) {
    assert.equal(consumeRateLimit("sync:shop", { capacity: 6, refillPerSecond: 1 / 20, now }).allowed, true);
  }
  const blocked = consumeRateLimit("sync:shop", { capacity: 6, refillPerSecond: 1 / 20, now });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("refills over time", () => {
  resetRateLimits();
  const now = Date.now();
  for (let i = 0; i < 6; i += 1) {
    consumeRateLimit("sync:shop", { capacity: 6, refillPerSecond: 1 / 20, now });
  }
  assert.equal(consumeRateLimit("sync:shop", { capacity: 6, refillPerSecond: 1 / 20, now }).allowed, false);
  const later = now + 21_000;
  assert.equal(consumeRateLimit("sync:shop", { capacity: 6, refillPerSecond: 1 / 20, now: later }).allowed, true);
});

test("buckets are per shop, so one merchant cannot starve another", () => {
  resetRateLimits();
  const now = Date.now();
  for (let i = 0; i < 6; i += 1) {
    consumeRateLimit("sync:a.myshopify.com", { capacity: 6, refillPerSecond: 1 / 20, now });
  }
  assert.equal(consumeRateLimit("sync:a.myshopify.com", { capacity: 6, refillPerSecond: 1 / 20, now }).allowed, false);
  assert.equal(consumeRateLimit("sync:b.myshopify.com", { capacity: 6, refillPerSecond: 1 / 20, now }).allowed, true);
});
