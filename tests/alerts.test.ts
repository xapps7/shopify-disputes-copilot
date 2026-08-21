import test from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_THRESHOLD_HOURS,
  OPENING_FRESHNESS_HOURS,
  alertToggleKey,
  evaluateDisputeAlerts,
  sortByUrgency,
  type AlertDisputeInput
} from "../lib/disputes/alert-rules.ts";

// Two failures matter here and they pull in opposite directions.
//
// Silence: Shopify sends no notification before a dispute deadline and then
// auto-submits. A merchant can lose four figures without knowing there was a
// decision to make.
//
// Noise: at 15 disputes a month, four emails each is 60 emails, and the measured
// override rate for high-frequency alerts is around 90%. An alert nobody reads
// costs trust in the ones that matter.

const NOW = new Date("2026-08-20T12:00:00.000Z");

function hoursFromNow(hours: number) {
  return new Date(NOW.getTime() + hours * 3_600_000);
}

function dispute(overrides: Partial<AlertDisputeInput> = {}): AlertDisputeInput {
  return {
    id: "d1",
    orderName: "#1024",
    amount: "180.00",
    currencyCode: "USD",
    evidenceDueBy: hoursFromNow(100),
    evidenceSentOn: null,
    status: "NEEDS_RESPONSE",
    hasEvidence: false,
    responseReady: false,
    openedAt: hoursFromNow(-2),
    ...overrides
  };
}

/** Every dispute is announced once first, so most tests start past that. */
const OPENED = new Set(["d1:DISPUTE_OPENED"]);

test("the first email is that a chargeback exists at all", () => {
  // Shopify tells the merchant nothing. This is the highest-value email in the
  // product and it must fire before any reminder logic.
  const [alert] = evaluateDisputeAlerts(dispute(), NOW, new Set());

  assert.equal(alert.kind, "DISPUTE_OPENED");
  assert.match(alert.title, /chargeback was opened/);
  // It carries the deadline, so an urgent dispute needs one email, not two.
  assert.match(alert.body, /Shopify answers for you/);
});

test("a dispute that arrives already urgent says so in the opening email", () => {
  const [alert] = evaluateDisputeAlerts(
    dispute({ evidenceDueBy: hoursFromNow(6) }),
    NOW,
    new Set()
  );

  assert.equal(alert.kind, "DISPUTE_OPENED");
  assert.match(alert.body, /within 24 hours/);
});

test("the opening email is never repeated", () => {
  const alerts = evaluateDisputeAlerts(dispute({ evidenceDueBy: hoursFromNow(100) }), NOW, OPENED);
  assert.deepEqual(alerts, [], "nothing else is due this far out");
});

test("warns at 72 hours, then escalates to 24 without repeating", () => {
  const at72 = evaluateDisputeAlerts(dispute({ evidenceDueBy: hoursFromNow(70) }), NOW, OPENED);
  assert.equal(at72[0].thresholdHours, 72);

  const sent72 = new Set([...OPENED, "d1:AUTO_SUBMIT_SOON:72"]);
  const at24 = evaluateDisputeAlerts(dispute({ evidenceDueBy: hoursFromNow(20) }), NOW, sent72);
  assert.equal(at24[0].thresholdHours, 24);

  const sentBoth = new Set([...sent72, "d1:AUTO_SUBMIT_SOON:24"]);
  assert.deepEqual(
    evaluateDisputeAlerts(dispute({ evidenceDueBy: hoursFromNow(20) }), NOW, sentBoth),
    [],
    "never the same threshold twice"
  );
});

test("an empty response is called out differently from a prepared one", () => {
  const empty = evaluateDisputeAlerts(
    dispute({ evidenceDueBy: hoursFromNow(20), hasEvidence: false }),
    NOW,
    OPENED
  );
  const started = evaluateDisputeAlerts(
    dispute({ evidenceDueBy: hoursFromNow(20), hasEvidence: true }),
    NOW,
    OPENED
  );

  assert.equal(empty[0].kind, "EVIDENCE_MISSING");
  assert.match(empty[0].body, /default data alone/);
  assert.equal(started[0].kind, "AUTO_SUBMIT_SOON");
});

test("a ready response stops the reminders", () => {
  // The suppression that keeps this from becoming noise. Chasing someone who is
  // already done is how the next email gets ignored.
  for (const hours of [70, 20, 2]) {
    assert.deepEqual(
      evaluateDisputeAlerts(
        dispute({ evidenceDueBy: hoursFromNow(hours), hasEvidence: true, responseReady: true }),
        NOW,
        OPENED
      ),
      [],
      `a ready response should not be chased at ${hours}h`
    );
  }
});

test("but a ready response is still told when Shopify has answered", () => {
  // Ready is not sent. If the deadline passes anyway, that is news.
  const [alert] = evaluateDisputeAlerts(
    dispute({ evidenceDueBy: hoursFromNow(-1), responseReady: true }),
    NOW,
    OPENED
  );

  assert.equal(alert.kind, "AUTO_SUBMITTED");
});

test("tells the merchant when Shopify has already responded, once", () => {
  const first = evaluateDisputeAlerts(dispute({ evidenceDueBy: hoursFromNow(-3) }), NOW, OPENED);
  assert.equal(first[0].kind, "AUTO_SUBMITTED");

  const again = evaluateDisputeAlerts(
    dispute({ evidenceDueBy: hoursFromNow(-3) }),
    NOW,
    new Set([...OPENED, "d1:AUTO_SUBMITTED"])
  );
  assert.deepEqual(again, []);
});

test("announces the outcome, and distinguishes winning from losing", () => {
  const won = evaluateDisputeAlerts(dispute({ status: "WON" }), NOW, OPENED);
  assert.equal(won[0].kind, "DISPUTE_DECIDED");
  assert.match(won[0].title, /you won/);

  const lost = evaluateDisputeAlerts(dispute({ status: "LOST" }), NOW, OPENED);
  assert.match(lost[0].title, /decided against you/);
  assert.match(lost[0].body, /final/);
});

test("a closed dispute goes quiet after the outcome email", () => {
  for (const status of ["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED", "CLOSED"]) {
    assert.deepEqual(
      evaluateDisputeAlerts(dispute({ status }), NOW, new Set([...OPENED, "d1:DISPUTE_DECIDED"])),
      [],
      `${status} should be silent once announced`
    );
  }
});

test("the outcome outranks the deadline", () => {
  // A dispute decided before its deadline must not also be chased.
  const alerts = evaluateDisputeAlerts(
    dispute({ status: "WON", evidenceDueBy: hoursFromNow(2) }),
    NOW,
    OPENED
  );
  assert.equal(alerts[0].kind, "DISPUTE_DECIDED");
});

test("stays quiet once the response has been sent", () => {
  assert.deepEqual(
    evaluateDisputeAlerts(
      dispute({ evidenceDueBy: hoursFromNow(20), evidenceSentOn: hoursFromNow(-2) }),
      NOW,
      OPENED
    ),
    []
  );
});

test("at most one email per dispute per sweep", () => {
  // The whole anti-noise contract in one assertion.
  for (const hours of [200, 70, 20, -1]) {
    for (const status of ["NEEDS_RESPONSE", "UNDER_REVIEW", "WON"]) {
      const alerts = evaluateDisputeAlerts(
        dispute({ evidenceDueBy: hoursFromNow(hours), status }),
        NOW,
        new Set()
      );
      assert.ok(alerts.length <= 1, `${status} at ${hours}h produced ${alerts.length}`);
    }
  }
});

test("a dispute with no published deadline is still announced", () => {
  const [alert] = evaluateDisputeAlerts(dispute({ evidenceDueBy: null }), NOW, new Set());

  assert.equal(alert.kind, "DISPUTE_OPENED");
  assert.match(alert.body, /has not published a deadline/);

  // And then nothing, because there is no clock to count down.
  assert.deepEqual(evaluateDisputeAlerts(dispute({ evidenceDueBy: null }), NOW, OPENED), []);
});

test("thresholds are ordered furthest-first so the nearer one wins", () => {
  assert.deepEqual([...ALERT_THRESHOLD_HOURS], [72, 24]);
});

test("the two emails that cannot be switched off", () => {
  // A merchant must not be able to opt out of learning that a chargeback exists
  // or that Shopify has already answered.
  assert.equal(alertToggleKey("DISPUTE_OPENED"), null);
  assert.equal(alertToggleKey("AUTO_SUBMITTED"), null);

  assert.equal(alertToggleKey("AUTO_SUBMIT_SOON"), "notifyDueSoon");
  assert.equal(alertToggleKey("EVIDENCE_MISSING"), "notifyMissingEvidence");
  assert.equal(alertToggleKey("DISPUTE_DECIDED"), "notifyDecided");
});

test("a batch leads with the worst news", () => {
  const batch = sortByUrgency([
    { disputeId: "a", kind: "DISPUTE_DECIDED", thresholdHours: null, title: "won", body: "", urgency: 1 },
    { disputeId: "b", kind: "AUTO_SUBMITTED", thresholdHours: null, title: "missed", body: "", urgency: 5 },
    { disputeId: "c", kind: "DISPUTE_OPENED", thresholdHours: null, title: "new", body: "", urgency: 2 }
  ]);

  assert.equal(batch[0].kind, "AUTO_SUBMITTED", "the subject line should reflect the worst state");
  assert.equal(batch[batch.length - 1].kind, "DISPUTE_DECIDED");
});


/* ------------------------------------------------------------------ *
 * History is not news
 *
 * The first sweep after shipping the opening email sees every dispute already
 * in the database. Announcing those as newly opened would make the very first
 * email a merchant ever receives a set of false alarms about cases that closed
 * weeks ago - and there is no recovering the channel's credibility after that.
 * ------------------------------------------------------------------ */

test("a dispute older than the freshness window is never announced as new", () => {
  const stale = dispute({
    openedAt: hoursFromNow(-(OPENING_FRESHNESS_HOURS + 1)),
    evidenceDueBy: hoursFromNow(100)
  });

  assert.deepEqual(evaluateDisputeAlerts(stale, NOW, new Set()), []);
});

test("a dispute with no known open date is treated as stale, not new", () => {
  assert.deepEqual(
    evaluateDisputeAlerts(dispute({ openedAt: null, evidenceDueBy: hoursFromNow(100) }), NOW, new Set()),
    []
  );
});

test("but a stale dispute still gets its reminders and its outcome", () => {
  const stale = { openedAt: hoursFromNow(-1000) };

  // Never announced, but the deadline still matters.
  const reminder = evaluateDisputeAlerts(
    dispute({ ...stale, evidenceDueBy: hoursFromNow(20) }),
    NOW,
    new Set()
  );
  assert.equal(reminder[0].kind, "EVIDENCE_MISSING");

  const decided = evaluateDisputeAlerts(dispute({ ...stale, status: "WON" }), NOW, new Set());
  assert.equal(decided[0].kind, "DISPUTE_DECIDED");
});

test("a passed deadline outranks the opening notice", () => {
  // Even for a dispute we have never announced: telling someone to act on a
  // case they can no longer change is worse than telling them it is gone.
  const [alert] = evaluateDisputeAlerts(
    dispute({ evidenceDueBy: hoursFromNow(-1) }),
    NOW,
    new Set()
  );

  assert.equal(alert.kind, "AUTO_SUBMITTED");
});

test("the freshness window is a week", () => {
  assert.equal(OPENING_FRESHNESS_HOURS, 168);

  // Just inside it is still news.
  const [alert] = evaluateDisputeAlerts(
    dispute({ openedAt: hoursFromNow(-(OPENING_FRESHNESS_HOURS - 1)), evidenceDueBy: hoursFromNow(100) }),
    NOW,
    new Set()
  );
  assert.equal(alert.kind, "DISPUTE_OPENED");
});
