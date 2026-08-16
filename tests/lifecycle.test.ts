import test from "node:test";
import assert from "node:assert/strict";

import {
  READY_THRESHOLD,
  STAGE_ORDER,
  countByStage,
  needsMerchant,
  rankForAttention,
  resolveStage
} from "../lib/disputes/lifecycle.ts";

// Stage is the axis the queue was missing: a dispute due tomorrow whose response
// is already built needs nothing, and one due in three weeks with nothing
// attached needs work today. Getting these rules wrong sends a merchant to the
// wrong case, which is the one failure this whole screen exists to prevent.

test("a decided dispute is closed however complete its evidence was", () => {
  for (const status of ["WON", "LOST", "ACCEPTED", "CLOSED", "CHARGE_REFUNDED"]) {
    assert.equal(
      resolveStage({ status, completenessScore: 100, hasEvidence: true }),
      "DECIDED",
      `${status} should be DECIDED`
    );
  }
});

test("submission outranks readiness", () => {
  // Showing "Ready to send" beside something already sent invites the merchant
  // to hunt for a button that cannot exist.
  assert.equal(
    resolveStage({
      status: "NEEDS_RESPONSE",
      evidenceSentOn: "2026-08-01T00:00:00.000Z",
      completenessScore: 100,
      hasEvidence: true
    }),
    "SUBMITTED"
  );

  assert.equal(
    resolveStage({ status: "UNDER_REVIEW", completenessScore: 20, hasEvidence: true }),
    "SUBMITTED"
  );
});

test("readiness uses the same threshold the queue badge uses", () => {
  const atBar = resolveStage({
    status: "NEEDS_RESPONSE",
    completenessScore: READY_THRESHOLD,
    hasEvidence: true
  });
  const justUnder = resolveStage({
    status: "NEEDS_RESPONSE",
    completenessScore: READY_THRESHOLD - 1,
    hasEvidence: true
  });

  assert.equal(atBar, "READY");
  assert.equal(justUnder, "BUILDING");
});

test("untouched is NEW, touched is BUILDING", () => {
  assert.equal(
    resolveStage({ status: "NEEDS_RESPONSE", completenessScore: 0, hasEvidence: false }),
    "NEW"
  );
  assert.equal(
    resolveStage({ status: "NEEDS_RESPONSE", completenessScore: 0, hasEvidence: true }),
    "BUILDING"
  );
});

test("only merchant stages count as a to-do", () => {
  assert.equal(needsMerchant("NEW"), true);
  assert.equal(needsMerchant("BUILDING"), true);
  assert.equal(needsMerchant("READY"), true);
  assert.equal(needsMerchant("SUBMITTED"), false);
  assert.equal(needsMerchant("DECIDED"), false);
});

test("the soonest deadline wins, because it is the only input that expires", () => {
  const soonSmall = rankForAttention({ stage: "NEW", hoursUntilAutoSubmit: 6, amount: 25 });
  const laterHuge = rankForAttention({ stage: "NEW", hoursUntilAutoSubmit: 400, amount: 9000 });

  assert.ok(soonSmall !== null && laterHuge !== null);
  assert.ok(soonSmall < laterHuge, "a $25 dispute auto-submitting tonight outranks $9000 due in weeks");
});

test("nothing owed means it is never the next action", () => {
  // READY is the subtle one: soonest deadline in the book, and still not the
  // thing to do, because there is nothing left to add to it.
  assert.equal(rankForAttention({ stage: "READY", hoursUntilAutoSubmit: 1, amount: 5000 }), null);
  assert.equal(rankForAttention({ stage: "SUBMITTED", hoursUntilAutoSubmit: 1, amount: 5000 }), null);
  assert.equal(rankForAttention({ stage: "DECIDED", hoursUntilAutoSubmit: null, amount: 5000 }), null);
});

test("a passed deadline is no longer actionable", () => {
  assert.equal(rankForAttention({ stage: "NEW", hoursUntilAutoSubmit: 0, amount: 500 }), null);
  assert.equal(rankForAttention({ stage: "BUILDING", hoursUntilAutoSubmit: -3, amount: 500 }), null);
});

test("no published deadline ranks behind everything with a clock, largest first", () => {
  const withClock = rankForAttention({ stage: "NEW", hoursUntilAutoSubmit: 900, amount: 10 });
  const noClockSmall = rankForAttention({ stage: "NEW", hoursUntilAutoSubmit: null, amount: 50 });
  const noClockBig = rankForAttention({ stage: "NEW", hoursUntilAutoSubmit: null, amount: 5000 });

  assert.ok(withClock !== null && noClockSmall !== null && noClockBig !== null);
  assert.ok(withClock < noClockBig, "a real deadline beats no deadline");
  assert.ok(noClockBig < noClockSmall, "among undated disputes, the larger one leads");
});

test("stage counts include the empty stages, in display order", () => {
  const counts = countByStage(["NEW", "NEW", "SUBMITTED"]);

  assert.deepEqual(
    counts.map((entry) => entry.stage),
    STAGE_ORDER,
    "every stage renders, so the pipeline does not change shape as work moves"
  );
  assert.equal(counts.find((entry) => entry.stage === "NEW")?.count, 2);
  assert.equal(counts.find((entry) => entry.stage === "SUBMITTED")?.count, 1);
  assert.equal(counts.find((entry) => entry.stage === "READY")?.count, 0);
});

test("stage labels avoid the enum, which means nothing to a merchant", () => {
  for (const entry of countByStage([])) {
    assert.ok(!/^[A-Z_]+$/.test(entry.label), `"${entry.label}" is a raw enum value`);
    assert.ok(entry.description.length > 0);
  }
});
