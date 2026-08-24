import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RETENTION_DAYS,
  ERASED_TEXT_PLACEHOLDER,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_GRACE_DAYS,
  RETAINED_OUTCOME_DATA,
  assessRetention,
  describeDisputeRetention,
  describeRetentionPolicy,
  describeSweepPlan,
  effectiveRetentionWindowDays,
  isDueForScrub,
  parseRetentionDays,
  planRetentionSweep,
  scrubbedJsonValue,
  type RetentionCandidate
} from "../lib/compliance/retention.ts";

// This module decides which merchant evidence gets destroyed. Every test below
// exists because getting it wrong is either a compliance failure (we promised
// erasure and kept the data) or an unrecoverable one (we shredded the evidence
// for a case an issuer can still reopen). The second is worse, so most of these
// tests assert that we KEEP.

const NOW = new Date("2026-08-24T12:00:00.000Z");
const MS_PER_DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

function finished(overrides: Partial<RetentionCandidate> = {}): RetentionCandidate {
  return {
    id: "d1",
    status: "LOST",
    finalizedOn: daysAgo(1000),
    ...overrides
  };
}

/* ------------------------------------------------------ settings parsing --- */

test("an absent or blank setting falls back to the shipped default", () => {
  assert.equal(parseRetentionDays(null), DEFAULT_RETENTION_DAYS);
  assert.equal(parseRetentionDays(undefined), DEFAULT_RETENTION_DAYS);
  assert.equal(parseRetentionDays(""), DEFAULT_RETENTION_DAYS);
  assert.equal(parseRetentionDays("   "), DEFAULT_RETENTION_DAYS);
});

test("garbage in the free-text field falls back to the default rather than to zero", () => {
  // The field is a string in a JSON text column. Number("") is 0 and
  // Number("0x10") is 16 - both would be catastrophic as a retention window.
  for (const raw of ["abc", "12 days", "1e9", "Infinity", "NaN", "0x10", "--5", "9,000", "1.2.3"]) {
    assert.equal(parseRetentionDays(raw), DEFAULT_RETENTION_DAYS, `${raw} should fall back`);
  }
});

test("a negative setting falls back to the default, it is never honoured", () => {
  assert.equal(parseRetentionDays("-1"), DEFAULT_RETENTION_DAYS);
  assert.equal(parseRetentionDays("-365"), DEFAULT_RETENTION_DAYS);
});

test("a setting below the floor is raised to the floor, not obeyed", () => {
  // A merchant typing 1 does not know the arbitration timetable. Honouring it
  // would destroy evidence for a case that can still be reopened.
  assert.equal(parseRetentionDays("1"), MIN_RETENTION_DAYS);
  assert.equal(parseRetentionDays("0"), MIN_RETENTION_DAYS);
  assert.equal(parseRetentionDays("89"), MIN_RETENTION_DAYS);
  assert.equal(MIN_RETENTION_DAYS, RETENTION_GRACE_DAYS);
});

test("a setting above the ceiling is capped, so the policy always has an end date", () => {
  assert.equal(parseRetentionDays("999999999"), MAX_RETENTION_DAYS);
  assert.equal(parseRetentionDays("2556"), MAX_RETENTION_DAYS);
});

test("a legitimate setting is passed through, and fractions round up", () => {
  assert.equal(parseRetentionDays("365"), 365);
  assert.equal(parseRetentionDays(" 180 "), 180);
  // Rounding down would delete a day earlier than the merchant asked for.
  assert.equal(parseRetentionDays("364.1"), 365);
});

test("the window is clamped again even if a caller skips the parser", () => {
  assert.equal(effectiveRetentionWindowDays(1), RETENTION_GRACE_DAYS);
  assert.equal(effectiveRetentionWindowDays(-50), RETENTION_GRACE_DAYS);
  assert.equal(effectiveRetentionWindowDays(99999), MAX_RETENTION_DAYS);
  assert.equal(effectiveRetentionWindowDays(Number.NaN), DEFAULT_RETENTION_DAYS);
});

/* ------------------------------------------------------- open disputes --- */

test("an open dispute is never swept, however old it is", () => {
  for (const status of ["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE"]) {
    const decision = assessRetention(
      { id: "d1", status, finalizedOn: daysAgo(5000), updatedAt: daysAgo(5000) },
      365,
      NOW
    );

    assert.equal(decision.verdict, "keep", `${status} must never be due`);
    assert.equal(decision.code, "open");
  }
});

test("a submitted-but-undecided dispute is locked, not finished, and is kept", () => {
  // lib/disputes/locking.ts treats "evidence sent" as read-only. Read-only is
  // not finished: the issuer has not ruled, and that evidence is the live case.
  const decision = assessRetention(
    { id: "d1", status: "UNDER_REVIEW", evidenceSentOn: daysAgo(900), updatedAt: daysAgo(900) },
    90,
    NOW
  );

  assert.equal(decision.verdict, "keep");
});

test("a status we do not recognise is kept and reported, not assumed finished", () => {
  for (const status of ["UNKNOWN", "", "   ", null, undefined, "SOME_FUTURE_STATUS"]) {
    const decision = assessRetention(
      { id: "d1", status, finalizedOn: daysAgo(5000) },
      365,
      NOW
    );

    assert.equal(decision.verdict, "keep", `${String(status)} must not be swept`);
    assert.equal(decision.code, "unrecognised_status");
  }
});

test("all four decided statuses are treated as finished", () => {
  for (const status of ["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED", "won", " lost "]) {
    assert.equal(
      isDueForScrub({ id: "d1", status, finalizedOn: daysAgo(1000) }, 365, NOW),
      true,
      `${status} should be sweepable`
    );
  }
});

/* --------------------------------------------------------- the 90 days --- */

test("the reopen grace beats a merchant asking for a shorter window", () => {
  // Passed unparsed on purpose: even a caller that bypasses parseRetentionDays
  // cannot delete inside the arbitration window.
  const insideGrace = finished({ finalizedOn: daysAgo(RETENTION_GRACE_DAYS - 1) });

  assert.equal(isDueForScrub(insideGrace, 1, NOW), false);
  assert.equal(isDueForScrub(insideGrace, 7, NOW), false);
  assert.equal(assessRetention(insideGrace, 1, NOW).windowDays, RETENTION_GRACE_DAYS);
});

test("a longer merchant window is respected over the grace period", () => {
  const old = finished({ finalizedOn: daysAgo(200) });

  assert.equal(isDueForScrub(old, RETENTION_GRACE_DAYS, NOW), true);
  assert.equal(isDueForScrub(old, 365, NOW), false, "365 days means 365 days");
});

/* ---------------------------------------------------------- boundaries --- */

test("a dispute sitting exactly on the limit is kept for one more day", () => {
  // Strict > plus whole-day flooring: the sweep must never delete a day early
  // because of clock skew, a timezone offset, or the minute it happened to run.
  assert.equal(isDueForScrub(finished({ finalizedOn: daysAgo(365) }), 365, NOW), false);
  assert.equal(isDueForScrub(finished({ finalizedOn: daysAgo(366) }), 365, NOW), true);
});

test("part of a day never tips a dispute over the limit", () => {
  const almost = finished({
    finalizedOn: new Date(NOW.getTime() - (365 * MS_PER_DAY + MS_PER_DAY - 1))
  });

  assert.equal(assessRetention(almost, 365, NOW).ageDays, 365);
  assert.equal(isDueForScrub(almost, 365, NOW), false);
});

test("the grace boundary behaves the same way", () => {
  assert.equal(isDueForScrub(finished({ finalizedOn: daysAgo(90) }), 1, NOW), false);
  assert.equal(isDueForScrub(finished({ finalizedOn: daysAgo(91) }), 1, NOW), true);
});

/* ------------------------------------------- missing finalisation date --- */

test("a missing finalisation date does not cause deletion inside the extended window", () => {
  // finalizedOn is only written by lib/disputes/outcomes.ts, so a dispute that
  // arrived already decided from a sync can be finished with no date at all.
  // The fallback timestamp can only be EARLIER than the real finalisation, so
  // the window gets an extra grace period on top to absorb the error.
  const window = 365;
  const extended = window + RETENTION_GRACE_DAYS;

  const justInside = finished({ finalizedOn: null, updatedAt: daysAgo(extended) });
  const justOutside = finished({ finalizedOn: null, updatedAt: daysAgo(extended + 1) });

  assert.equal(isDueForScrub(justInside, window, NOW), false);
  assert.equal(assessRetention(justInside, window, NOW).windowDays, extended);

  const due = assessRetention(justOutside, window, NOW);
  assert.equal(due.verdict, "due");
  assert.equal(due.code, "due_by_proxy");
  assert.equal(due.anchor, "updatedAt");
});

test("a dispute the merchant's own window would already have swept survives on the proxy", () => {
  // Same age, same setting - the only difference is the missing date. It buys
  // 90 more days rather than being deleted on a guess.
  const dated = finished({ finalizedOn: daysAgo(400) });
  const undated = finished({ finalizedOn: null, updatedAt: daysAgo(400) });

  assert.equal(isDueForScrub(dated, 365, NOW), true);
  assert.equal(isDueForScrub(undated, 365, NOW), false);
});

test("the proxy uses the latest timestamp available, never the earliest", () => {
  const decision = assessRetention(
    finished({ finalizedOn: null, evidenceSentOn: daysAgo(900), updatedAt: daysAgo(500) }),
    365,
    NOW
  );

  assert.equal(decision.anchor, "updatedAt");
  assert.equal(decision.ageDays, 500);
});

test("evidenceSentOn is used when it is the only timestamp", () => {
  const decision = assessRetention(
    finished({ finalizedOn: null, updatedAt: null, evidenceSentOn: daysAgo(900) }),
    365,
    NOW
  );

  assert.equal(decision.anchor, "evidenceSentOn");
  assert.equal(decision.verdict, "due");
});

test("a finished dispute with no usable date at all is kept, and flagged", () => {
  const decision = assessRetention(
    { id: "d1", status: "WON", finalizedOn: null, evidenceSentOn: null, updatedAt: null },
    365,
    NOW
  );

  assert.equal(decision.verdict, "keep");
  assert.equal(decision.code, "no_anchor");
  assert.equal(decision.anchor, null);

  // Flagged rather than silently counted as kept: a silent skip is how personal
  // data ends up living forever.
  const plan = planRetentionSweep([{ id: "d1", status: "WON" }], 365, NOW);
  assert.deepEqual(plan.unaged, ["d1"]);
  assert.match(plan.summary, /no usable date/);
});

test("an unparseable date is treated as missing, not as the epoch", () => {
  // new Date("banana") is Invalid Date; reading it as time 0 would make every
  // such dispute 56 years old and instantly due.
  const decision = assessRetention(
    { id: "d1", status: "WON", finalizedOn: "banana", updatedAt: "also-not-a-date" },
    365,
    NOW
  );

  assert.equal(decision.verdict, "keep");
  assert.equal(decision.code, "no_anchor");
});

test("a future-dated dispute is kept rather than read as very old", () => {
  const decision = assessRetention(
    finished({ finalizedOn: new Date(NOW.getTime() + 5 * MS_PER_DAY) }),
    365,
    NOW
  );

  assert.equal(decision.verdict, "keep");
  assert.equal(decision.code, "future_dated");
  assert.ok((decision.ageDays ?? 0) < 0);
});

test("date strings and Date objects are handled identically", () => {
  const asDate = assessRetention(finished({ finalizedOn: daysAgo(400) }), 365, NOW);
  const asString = assessRetention(finished({ finalizedOn: daysAgo(400).toISOString() }), 365, NOW);

  assert.deepEqual(asString, asDate);
});

/* --------------------------------------------------------------- plans --- */

const BATCH: RetentionCandidate[] = [
  { id: "c-old-won", status: "WON", finalizedOn: daysAgo(500) },
  { id: "a-open", status: "NEEDS_RESPONSE", finalizedOn: null, updatedAt: daysAgo(900) },
  { id: "b-recent-lost", status: "LOST", finalizedOn: daysAgo(10) },
  { id: "e-undated", status: "ACCEPTED" },
  { id: "d-unknown", status: "UNKNOWN", finalizedOn: daysAgo(900) }
];

test("the plan splits due from keep and sorts both", () => {
  const plan = planRetentionSweep(BATCH, 365, NOW);

  assert.deepEqual(plan.due, ["c-old-won"]);
  assert.deepEqual(plan.keep, ["a-open", "b-recent-lost", "d-unknown", "e-undated"]);
  assert.deepEqual(plan.decisions.map((decision) => decision.id), [
    "a-open",
    "b-recent-lost",
    "c-old-won",
    "d-unknown",
    "e-undated"
  ]);
  assert.deepEqual(plan.unrecognised, ["d-unknown"]);
  assert.deepEqual(plan.unaged, ["e-undated"]);
});

test("the plan is deterministic and independent of input order", () => {
  const forwards = planRetentionSweep(BATCH, 365, NOW);
  const backwards = planRetentionSweep([...BATCH].reverse(), 365, NOW);
  const shuffled = planRetentionSweep([BATCH[3], BATCH[0], BATCH[4], BATCH[1], BATCH[2]], 365, NOW);

  assert.deepEqual(backwards, forwards);
  assert.deepEqual(shuffled, forwards);
  assert.deepEqual(planRetentionSweep(BATCH, 365, NOW), forwards);
});

test("the plan records the requested setting alongside the window applied", () => {
  const plan = planRetentionSweep(BATCH, 1, NOW);

  assert.equal(plan.requestedRetentionDays, 1);
  assert.equal(plan.windowDays, RETENTION_GRACE_DAYS);
  assert.match(plan.summary, /adjusted to respect the 90-day reopen grace/);
});

test("a duplicated dispute cannot have a keep turned into a delete", () => {
  // Two rows for one id can only come from a bad join. The safe reading wins
  // regardless of which one is seen first.
  const due: RetentionCandidate = { id: "same", status: "WON", finalizedOn: daysAgo(900) };
  const keep: RetentionCandidate = { id: "same", status: "NEEDS_RESPONSE" };

  assert.deepEqual(planRetentionSweep([due, keep], 365, NOW).due, []);
  assert.deepEqual(planRetentionSweep([keep, due], 365, NOW).due, []);
});

test("an empty batch produces an empty, honest plan", () => {
  const plan = planRetentionSweep([], 365, NOW);

  assert.deepEqual(plan.due, []);
  assert.deepEqual(plan.keep, []);
  assert.equal(plan.now, NOW.toISOString());
  assert.match(plan.summary, /0 of 0/);
});

/* ------------------------------------------------------- what we say --- */

test("every description names the outcome data that is KEPT", () => {
  // The win-probability engine reads this history. Erasing it silently would
  // degrade the product and nobody would connect the two events.
  const plan = planRetentionSweep(BATCH, 365, NOW);

  for (const text of [plan.summary, describeRetentionPolicy(365)]) {
    assert.match(text, /reason code/i);
    assert.match(text, /amount/i);
    assert.match(text, /currency/i);
    assert.match(text, /won/i);
  }

  const dueDecision = plan.decisions.find((decision) => decision.verdict === "due");
  assert.ok(dueDecision);
  assert.match(describeDisputeRetention(dueDecision), /Kept: reason code, amount, currency and the won\/lost outcome/);
  assert.match(describeDisputeRetention(dueDecision), /Erased:/);
});

test("a kept dispute is described as kept, with the reason", () => {
  const decision = assessRetention(finished({ finalizedOn: daysAgo(10) }), 365, NOW);

  assert.equal(describeDisputeRetention(decision), decision.reason);
  assert.match(decision.reason, /inside its 365-day window/);
});

test("the retained-outcome list names the four fields the attestation promises", () => {
  const joined = RETAINED_OUTCOME_DATA.join(" ");

  assert.match(joined, /reason code/);
  assert.match(joined, /Dispute\.amount/);
  assert.match(joined, /Dispute\.currencyCode/);
  assert.match(joined, /won\/lost/);
});

test("the policy sentence is generated from the window in force, so the two cannot disagree", () => {
  assert.match(describeRetentionPolicy(180), /180 days after it is finalised/);
  // A shorter setting must not produce a sentence promising something we do not do.
  assert.match(describeRetentionPolicy(1), /90 days after it is finalised/);
  assert.match(describeRetentionPolicy(1), /never fewer than 90 days/);
});

test("the summary reports how many were skipped and why", () => {
  const summary = describeSweepPlan({
    now: NOW.toISOString(),
    requestedRetentionDays: 365,
    windowDays: 365,
    graceDays: RETENTION_GRACE_DAYS,
    due: ["a"],
    keep: ["b", "c"],
    unaged: ["b"],
    unrecognised: ["c"]
  });

  assert.match(summary, /1 of 3/);
  assert.match(summary, /2 kept/);
  assert.match(summary, /can never age out/);
  assert.match(summary, /cannot confirm is finished/);
});

/* --------------------------------------------------------- erasure --- */

test("erasure reuses the webhook scrubber rather than a second implementation", () => {
  // One scrubber, one set of PII keys. Two would drift and the drifting one
  // would leak.
  const scrubbed = scrubbedJsonValue(
    JSON.stringify({ name: "#1001", email: "buyer@example.com", customer: { id: 1 }, totalPrice: "42.00" })
  );

  assert.ok(scrubbed);
  const parsed = JSON.parse(scrubbed) as Record<string, unknown>;

  assert.equal(parsed.email, null);
  assert.equal(parsed.customer, null);
  assert.equal(parsed.name, "#1001", "order name is not personal data and is load-bearing in the UI");
  assert.equal(parsed.totalPrice, "42.00", "the amount is retained outcome data");
});

test("a null JSON column stays null and unparseable JSON is replaced, not passed through", () => {
  assert.equal(scrubbedJsonValue(null), null);
  assert.equal(scrubbedJsonValue(undefined), null);

  const broken = scrubbedJsonValue("{not json");
  assert.ok(broken);
  assert.match(broken, /redacted/);
});

test("the free-text placeholder explains itself", () => {
  // EvidenceItem.title is NOT NULL. A blank title leaves a row the merchant
  // cannot interpret; saying why is equally erased and more useful.
  assert.match(ERASED_TEXT_PLACEHOLDER, /retention/i);
  assert.notEqual(ERASED_TEXT_PLACEHOLDER.trim(), "");
});
