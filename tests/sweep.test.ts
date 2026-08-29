import test from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_PHASE_BUDGET_MS,
  ALERT_START_RESERVE_MS,
  MERCHANT_ALERT_DEADLINE_MS,
  MERCHANT_SYNC_DEADLINE_MS,
  SWEEP_TOTAL_BUDGET_MS,
  SYNC_PHASE_BUDGET_MS,
  SYNC_START_RESERVE_MS,
  canStartWithin,
  orderByStaleness,
  rotate,
  runWithConcurrency,
  summariseSweep,
  withDeadline,
  type SweepCandidate,
  type SweepResult
} from "../lib/disputes/sweep-plan.ts";

// The bug these guard is not "the sweep is slow". It is that a slow sweep was
// killed at the same end of the same list every hour, so a fixed set of
// merchants stopped syncing AND stopped getting deadline emails, invisibly,
// behind a 200.
//
// So the properties worth asserting are about fairness and honesty rather than
// throughput: whoever waited longest goes first, nothing is started that cannot
// finish, and a merchant we could not reach is counted as unreached instead of
// disappearing from the results.

const merchant = (shopDomain: string, lastSyncStartedAt: Date | null): SweepCandidate => ({
  merchantId: `m_${shopDomain}`,
  shopDomain,
  lastSyncStartedAt
});

const at = (iso: string) => new Date(iso);

test("rotation puts the least-recently-synced merchant first", () => {
  const order = orderByStaleness([
    merchant("fresh.myshopify.com", at("2026-08-29T10:00:00Z")),
    merchant("stale.myshopify.com", at("2026-08-29T04:00:00Z")),
    merchant("middling.myshopify.com", at("2026-08-29T08:00:00Z"))
  ]);

  assert.deepEqual(
    order.map((candidate) => candidate.shopDomain),
    ["stale.myshopify.com", "middling.myshopify.com", "fresh.myshopify.com"]
  );
});

test("a merchant that has never synced goes ahead of everyone", () => {
  // Almost always a fresh install. They open the app, and an empty queue reads
  // as a broken app rather than as a sync that has not happened yet.
  const order = orderByStaleness([
    merchant("old.myshopify.com", at("2020-01-01T00:00:00Z")),
    merchant("new.myshopify.com", null)
  ]);

  assert.equal(order[0]?.shopDomain, "new.myshopify.com");
});

test("ordering is stable so a truncated run is reproducible", () => {
  const sameMoment = at("2026-08-29T09:00:00Z");
  const order = orderByStaleness([
    merchant("c.myshopify.com", sameMoment),
    merchant("a.myshopify.com", sameMoment),
    merchant("b.myshopify.com", sameMoment)
  ]);

  assert.deepEqual(
    order.map((candidate) => candidate.shopDomain),
    ["a.myshopify.com", "b.myshopify.com", "c.myshopify.com"]
  );
});

test("the merchant cut off this hour is first in line next hour", () => {
  // The property that makes truncation survivable. Half the fleet is synced,
  // the rest is not, and the next run starts with exactly the ones that missed.
  const fleet = orderByStaleness(
    Array.from({ length: 6 }, (_, index) =>
      merchant(`shop-${index}.myshopify.com`, at(`2026-08-29T0${index}:00:00Z`))
    )
  );

  const syncedThisHour = fleet.slice(0, 3);
  const missed = fleet.slice(3);

  const nextHour = orderByStaleness([
    ...syncedThisHour.map((candidate) => merchant(candidate.shopDomain, at("2026-08-29T12:00:00Z"))),
    ...missed
  ]);

  assert.deepEqual(
    nextHour.slice(0, 3).map((candidate) => candidate.shopDomain),
    missed.map((candidate) => candidate.shopDomain)
  );
});

test("the budget refuses work it cannot finish, not work that is merely close", () => {
  // The reserve is one merchant's deadline, so anything started still lands
  // inside the budget. Exactly one deadline left is still enough.
  assert.equal(canStartWithin(0, 150_000, 60_000), true);
  assert.equal(canStartWithin(90_000, 150_000, 60_000), true);
  assert.equal(canStartWithin(90_001, 150_000, 60_000), false);
  assert.equal(canStartWithin(200_000, 150_000, 60_000), false);
});

test("the phase budgets fit inside maxDuration with headroom", () => {
  // If someone raises a budget without checking the others, this is the test
  // that says so rather than a killed invocation at 3am.
  assert.ok(SYNC_PHASE_BUDGET_MS < ALERT_PHASE_BUDGET_MS);
  assert.ok(ALERT_PHASE_BUDGET_MS <= SWEEP_TOTAL_BUDGET_MS);
  assert.ok(SWEEP_TOTAL_BUDGET_MS <= 300_000 - 30_000);
  // The reserve has to be at least the deadline, or a merchant we start can
  // outlive the budget and the guarantee is only a hope.
  assert.ok(SYNC_START_RESERVE_MS >= MERCHANT_SYNC_DEADLINE_MS);
  assert.ok(ALERT_START_RESERVE_MS >= MERCHANT_ALERT_DEADLINE_MS);
});

test("the time budget stops new merchants instead of truncating one mid-sync", async () => {
  // A fake clock that only moves when work happens, so the assertion is about
  // the scheduling rule and not about how fast this machine is.
  let now = 0;
  const started: string[] = [];
  const finished: string[] = [];

  const fleet = Array.from({ length: 10 }, (_, index) => `shop-${index}`);

  const run = await runWithConcurrency(
    fleet,
    1,
    async (shop) => {
      started.push(shop);
      await Promise.resolve();
      now += 20;
      finished.push(shop);
      return shop;
    },
    () => canStartWithin(now, 100, 10)
  );

  // Claims at 0, 20, 40, 60 and 80; at 100 there is no longer room for another.
  assert.deepEqual(started, ["shop-0", "shop-1", "shop-2", "shop-3", "shop-4"]);
  // Every merchant that was started also finished. Nothing was cut in half.
  assert.deepEqual(finished, started);
  assert.deepEqual(run.results, started);
  assert.deepEqual(run.remaining, ["shop-5", "shop-6", "shop-7", "shop-8", "shop-9"]);
});

test("concurrency never exceeds the limit", async () => {
  let inFlight = 0;
  let peak = 0;

  const fleet = Array.from({ length: 25 }, (_, index) => index);

  const run = await runWithConcurrency(fleet, 4, async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return value * 2;
  });

  assert.equal(peak, 4);
  assert.equal(run.results.length, 25);
  assert.deepEqual(run.results.slice(0, 3), [0, 2, 4]);
  assert.deepEqual(run.remaining, []);
});

test("results come back in fleet order however the lanes interleave", async () => {
  // Rotation only means anything if the reporting agrees with it, and lanes
  // finish out of order by design - a fast shop overtakes a slow one.
  const fleet = ["a", "b", "c", "d", "e", "f"];

  const run = await runWithConcurrency(fleet, 3, async (shop, index) => {
    await new Promise((resolve) => setTimeout(resolve, (fleet.length - index) % 4));
    return shop.toUpperCase();
  });

  assert.deepEqual(run.results, ["A", "B", "C", "D", "E", "F"]);
});

test("one merchant blowing up does not abandon the lanes still running", async () => {
  // Bailing out on the first rejection would leave five lanes writing to the
  // database after the response had already gone out.
  const fleet = ["ok-1", "boom", "ok-2", "ok-3"];
  const completed: string[] = [];

  await assert.rejects(
    runWithConcurrency(fleet, 2, async (shop) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (shop === "boom") {
        throw new Error("Sync failed.");
      }
      completed.push(shop);
      return shop;
    }),
    /Sync failed./
  );

  assert.deepEqual(completed.sort(), ["ok-1", "ok-2", "ok-3"]);
});

test("an empty fleet is a no-op, not a hang", async () => {
  const run = await runWithConcurrency([], 6, async () => "never");
  assert.deepEqual(run.results, []);
  assert.deepEqual(run.remaining, []);
});

test("a merchant skipped for time is reported as skipped, not dropped", async () => {
  // The whole point. The old sweep returned a short array and a 200, so a
  // merchant that fell off the end was indistinguishable from one that did not
  // exist.
  let now = 0;

  const fleet = orderByStaleness(
    Array.from({ length: 8 }, (_, index) =>
      merchant(`shop-${index}.myshopify.com`, at(`2026-08-29T0${index}:00:00Z`))
    )
  );

  // Phase one: Shopify syncs, expensive, budget runs out after three.
  const syncPhase = await runWithConcurrency(
    fleet,
    2,
    async (candidate): Promise<SweepResult> => {
      now += 30;
      return { shopDomain: candidate.shopDomain, outcome: "SYNCED", synced: 2, alerts: 1, error: null };
    },
    () => canStartWithin(now, 100, 10)
  );

  // Phase two: alerts only, cheap, database alone, and it runs out too - which
  // is the case worth covering, because it is the only one that leaves a
  // merchant with neither fresh data nor a deadline check.
  const alertPhase = await runWithConcurrency(
    syncPhase.remaining,
    2,
    async (candidate): Promise<SweepResult> => {
      now += 20;
      return { shopDomain: candidate.shopDomain, outcome: "ALERTS_ONLY", synced: null, alerts: 1, error: null };
    },
    () => canStartWithin(now, 160, 10)
  );

  const skipped: SweepResult[] = alertPhase.remaining.map((candidate) => ({
    shopDomain: candidate.shopDomain,
    outcome: "SKIPPED",
    synced: null,
    alerts: 0,
    error: null
  }));

  const results = [...syncPhase.results, ...alertPhase.results, ...skipped];
  const summary = summariseSweep(results);

  // Every installed merchant is accounted for exactly once.
  assert.equal(summary.merchants, fleet.length);
  assert.deepEqual(
    [...results.map((result) => result.shopDomain)].sort(),
    [...fleet.map((candidate) => candidate.shopDomain)].sort()
  );

  assert.equal(summary.processed, 4);
  assert.equal(summary.alertsOnly, 2);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.complete, false);

  // And the ones we could not sync are the ones that were freshest already.
  assert.deepEqual(
    results.filter((result) => result.outcome !== "SYNCED").map((result) => result.shopDomain),
    fleet.slice(4).map((candidate) => candidate.shopDomain)
  );
});

test("alerts still go out for merchants the sync never reached", async () => {
  // Ordering the two phases the other way round would be the easy mistake:
  // stale dispute lists cost a merchant nothing for an hour, a missed evidence
  // deadline costs them the dispute.
  const results: SweepResult[] = [
    { shopDomain: "a.myshopify.com", outcome: "SYNCED", synced: 3, alerts: 1, error: null },
    { shopDomain: "b.myshopify.com", outcome: "ALERTS_ONLY", synced: null, alerts: 2, error: null }
  ];

  const summary = summariseSweep(results);
  assert.equal(summary.alerts, 3);
  assert.equal(summary.disputesSynced, 3);
  assert.equal(summary.complete, false);
});

test("a full sweep with no failures reports complete", () => {
  const summary = summariseSweep([
    { shopDomain: "a.myshopify.com", outcome: "SYNCED", synced: 1, alerts: 0, error: null },
    { shopDomain: "b.myshopify.com", outcome: "SYNCED", synced: 0, alerts: 0, error: null }
  ]);

  assert.equal(summary.complete, true);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.failed, 0);
});

test("a failed sync is counted but does not make the run incomplete", () => {
  // A shop whose token Shopify has rejected fails every hour. That is a real
  // problem for that shop and not a reason to call the fleet sweep truncated.
  const summary = summariseSweep([
    { shopDomain: "a.myshopify.com", outcome: "SYNCED", synced: null, alerts: 1, error: "401" }
  ]);

  assert.equal(summary.failed, 1);
  assert.equal(summary.complete, true);
});

test("an empty fleet is a complete sweep", () => {
  const summary = summariseSweep([]);
  assert.equal(summary.complete, true);
  assert.equal(summary.merchants, 0);
});

test("rotate moves the starting point without losing anyone", () => {
  const shops = ["a", "b", "c", "d"];

  assert.deepEqual(rotate(shops, 0), ["a", "b", "c", "d"]);
  assert.deepEqual(rotate(shops, 1), ["b", "c", "d", "a"]);
  assert.deepEqual(rotate(shops, 6), ["c", "d", "a", "b"]);
  // Hours since the epoch is always positive, but a negative offset must not
  // throw or silently return an empty list.
  assert.deepEqual(rotate(shops, -1), ["d", "a", "b", "c"]);
  assert.deepEqual(rotate([], 3), []);
});

test("a deadline gives up on work rather than waiting for it", async () => {
  await assert.rejects(
    withDeadline(new Promise(() => {}), 5, "Sync exceeded its deadline and was abandoned."),
    /abandoned/
  );
});

test("work that finishes inside its deadline is untouched", async () => {
  const value = await withDeadline(Promise.resolve(42), 1_000, "never");
  assert.equal(value, 42);
});

test("a deadline does not swallow the real error", async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error("401 Unauthorized")), 1_000, "never"), /401/);
});
