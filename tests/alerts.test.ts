import test from "node:test";
import assert from "node:assert/strict";

import { ALERT_THRESHOLD_HOURS, evaluateDisputeAlerts } from "../lib/disputes/alert-rules.ts";


const NOW = new Date("2026-08-13T12:00:00.000Z");

function dispute(overrides: Partial<Parameters<typeof evaluateDisputeAlerts>[0]> = {}) {
  return {
    id: "d1",
    orderName: "#1005",
    amount: "1025.00",
    currencyCode: "USD",
    evidenceDueBy: new Date("2026-08-16T12:00:00.000Z"), // 72h out
    evidenceSentOn: null,
    status: "NEEDS_RESPONSE",
    hasEvidence: false,
    ...overrides
  };
}

test("warns at 72 hours before Shopify auto-submits", () => {
  const alerts = evaluateDisputeAlerts(dispute(), NOW, new Set());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].thresholdHours, 72);
  assert.match(alerts[0].title, /Shopify responds in 3 days/);
});

test("an empty response is called out differently from a prepared one", () => {
  const empty = evaluateDisputeAlerts(dispute(), NOW, new Set());
  assert.equal(empty[0].kind, "EVIDENCE_MISSING");
  assert.match(empty[0].body, /Shopify will respond with its default data alone/);

  const prepared = evaluateDisputeAlerts(dispute({ hasEvidence: true }), NOW, new Set());
  assert.equal(prepared[0].kind, "AUTO_SUBMIT_SOON");
});

test("escalates to the 24 hour warning without repeating the 72 hour one", () => {
  const soon = dispute({ evidenceDueBy: new Date("2026-08-14T06:00:00.000Z") }); // 18h out
  const alerts = evaluateDisputeAlerts(soon, NOW, new Set(["d1:AUTO_SUBMIT_SOON:72"]));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].thresholdHours, 24);
});

test("never sends the same threshold twice", () => {
  const seen = new Set(["d1:AUTO_SUBMIT_SOON:72"]);
  assert.deepEqual(evaluateDisputeAlerts(dispute(), NOW, seen), []);
});

test("tells the merchant when Shopify has already responded for them", () => {
  const passed = dispute({ evidenceDueBy: new Date("2026-08-12T12:00:00.000Z") });
  const alerts = evaluateDisputeAlerts(passed, NOW, new Set());
  assert.equal(alerts[0].kind, "AUTO_SUBMITTED");
  assert.match(alerts[0].body, /Shopify submitted a response using whatever it had/);
});

test("stays quiet once evidence is sent or the dispute is closed", () => {
  assert.deepEqual(evaluateDisputeAlerts(dispute({ evidenceSentOn: NOW }), NOW, new Set()), []);
  assert.deepEqual(evaluateDisputeAlerts(dispute({ status: "WON" }), NOW, new Set()), []);
  assert.deepEqual(evaluateDisputeAlerts(dispute({ status: "LOST" }), NOW, new Set()), []);
  assert.deepEqual(evaluateDisputeAlerts(dispute({ evidenceDueBy: null }), NOW, new Set()), []);
});

test("stays quiet far from the deadline", () => {
  const far = dispute({ evidenceDueBy: new Date("2026-08-30T12:00:00.000Z") });
  assert.deepEqual(evaluateDisputeAlerts(far, NOW, new Set()), []);
});

test("thresholds are ordered furthest-first so the nearer one wins", () => {
  assert.deepEqual([...ALERT_THRESHOLD_HOURS], [72, 24]);
});
