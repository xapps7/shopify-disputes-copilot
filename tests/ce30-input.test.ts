import test from "node:test";
import assert from "node:assert/strict";

import {
  ce30ElementsFromOrder,
  hashBrowserIp,
  hashShippingAddress,
  projectOrder
} from "../lib/compliance/order-projection.ts";
import { scrubJsonString } from "../lib/compliance/scrub.ts";
import { assessCe30, matchingElements, type Ce30Candidate } from "../lib/disputes/ce30.ts";

// Two failures are being guarded against here, and neither is a crash.
//
// The first is storing a home address or an IP in the app's longest-lived table
// to answer a question that only ever asks "are these two the same?". The
// projection must emit digests and nothing readable.
//
// The second is quieter and worse: a hash that changes when the address does not.
// CE 3.0 matching is equality, so if "221B Baker St." and "221b baker st" hash
// differently, a genuine Visa match is lost to punctuation and the merchant is
// told they have no qualifying history when they do.

const ADDRESS = {
  name: "Sherlock Holmes",
  address1: "221B Baker St.",
  address2: null,
  city: "London",
  province: "England",
  provinceCode: "ENG",
  zip: "NW1 6XE",
  country: "United Kingdom",
  countryCodeV2: "GB"
};

test("the stored address is a digest, not an address", () => {
  const hash = hashShippingAddress(ADDRESS);

  assert.match(hash ?? "", /^[0-9a-f]{64}$/);
  // Nothing recoverable: no street, no postcode, no city.
  assert.ok(!(hash ?? "").includes("221"));
  assert.ok(!(hash ?? "").toLowerCase().includes("baker"));
});

test("cosmetic differences in one address produce one hash", () => {
  const punctuated = hashShippingAddress(ADDRESS);
  const plain = hashShippingAddress({
    address1: "221b baker st",
    city: "LONDON",
    provinceCode: "eng",
    zip: "nw1  6xe",
    countryCodeV2: "gb"
  });

  assert.equal(punctuated, plain);
});

test("a different doorstep produces a different hash", () => {
  assert.notEqual(hashShippingAddress(ADDRESS), hashShippingAddress({ ...ADDRESS, address1: "222B Baker St." }));
  assert.notEqual(hashShippingAddress(ADDRESS), hashShippingAddress({ ...ADDRESS, zip: "NW1 6XF" }));
});

test("the recipient name is not part of the address", () => {
  // A gift order is the same doorstep. Including the name would throw away a
  // match Visa would have honoured.
  assert.equal(hashShippingAddress(ADDRESS), hashShippingAddress({ ...ADDRESS, name: "John Watson" }));
});

test("an empty or absent address hashes to nothing rather than to a constant", () => {
  // The failure this prevents: every address-less order sharing one digest, and
  // matching each other on it.
  assert.equal(hashShippingAddress(null), null);
  assert.equal(hashShippingAddress({}), null);
  assert.equal(hashShippingAddress({ address1: "   " }), null);
  assert.equal(hashShippingAddress("!!!"), null);
});

test("IP digests are stable under case and padding, and empty stays empty", () => {
  assert.equal(hashBrowserIp(" 2001:DB8::1 "), hashBrowserIp("2001:db8::1"));
  assert.notEqual(hashBrowserIp("203.0.113.9"), hashBrowserIp("203.0.113.10"));
  assert.equal(hashBrowserIp(""), null);
  assert.equal(hashBrowserIp(null), null);
  assert.equal(hashBrowserIp(42), null);
});

test("an address and an IP that render alike do not collide", () => {
  // Domain separation. Without it, one string could match across two elements
  // and manufacture Visa's second matching element out of nothing.
  assert.notEqual(hashShippingAddress("203.0.113.9"), hashBrowserIp("203.0.113.9"));
});

test("the projection stores digests and drops the raw address and IP", () => {
  const projected = projectOrder({
    id: "gid://shopify/Order/1",
    name: "#1001",
    createdAt: "2026-01-05T00:00:00.000Z",
    shippingAddress: ADDRESS,
    clientDetails: { browserIp: "203.0.113.9" },
    customer: { firstName: "Sherlock", lastName: "Holmes", email: "buyer@example.com" }
  });

  const stored = JSON.stringify(projected);
  assert.ok(!stored.includes("Baker"));
  assert.ok(!stored.includes("NW1"));
  assert.ok(!stored.includes("203.0.113.9"));
  assert.equal(projected?.shippingAddress?.hash, hashShippingAddress(ADDRESS));
  assert.equal(projected?.clientDetails?.browserIpHash, hashBrowserIp("203.0.113.9"));
  // The order date has to survive: it is what places a prior in Visa's window.
  assert.equal(projected?.createdAt, "2026-01-05T00:00:00.000Z");
});

test("customers/redact erases the digests along with everything else", () => {
  // This is why the digests keep the keys the raw values had. `scrubJsonString`
  // nulls subtrees by exact key name, so a digest parked under a new key such as
  // `shippingAddressHash` would survive a deletion request that was meant to
  // remove it - an identifier derived from a home address, left behind.
  const stored = JSON.stringify(
    projectOrder({
      id: "gid://shopify/Order/1",
      shippingAddress: ADDRESS,
      clientDetails: { browserIp: "203.0.113.9" },
      customer: { email: "buyer@example.com" }
    })
  );

  const scrubbed = scrubJsonString(stored) ?? "";

  assert.ok(!scrubbed.includes(hashShippingAddress(ADDRESS) ?? "never"));
  assert.ok(!scrubbed.includes(hashBrowserIp("203.0.113.9") ?? "never"));
  assert.ok(!scrubbed.includes("buyer@example.com"));
  // A scrubbed snapshot must still assess cleanly, as a dispute with no elements
  // at all rather than a crash on the dispute page.
  assert.deepEqual(ce30ElementsFromOrder(JSON.parse(scrubbed)), {
    customerEmail: null,
    ip: null,
    deviceId: null,
    shippingAddressHash: null,
    userId: null
  });
});

test("elements read the same whether the order is raw or already projected", () => {
  // The two sides of a CE 3.0 comparison come from different tables - the
  // disputed order from the full dispute payload, its priors from the projected
  // snapshot. If the two shapes fingerprinted differently, nothing would ever
  // match and the card would refuse every dispute for no visible reason.
  const raw = {
    shippingAddress: ADDRESS,
    clientDetails: { browserIp: "203.0.113.9" },
    customer: { email: "buyer@example.com" }
  };

  const fromRaw = ce30ElementsFromOrder(raw);
  const fromProjected = ce30ElementsFromOrder(projectOrder(raw));

  assert.deepEqual(fromRaw, fromProjected);
  assert.deepEqual(matchingElements(fromRaw, fromProjected), ["ipAddress", "shippingAddress"]);
});

test("elements degrade to nulls instead of throwing on junk", () => {
  const empty = { customerEmail: null, ip: null, deviceId: null, shippingAddressHash: null, userId: null };

  assert.deepEqual(ce30ElementsFromOrder(null), empty);
  assert.deepEqual(ce30ElementsFromOrder("not an order"), empty);
  assert.deepEqual(ce30ElementsFromOrder({ customer: 7, shippingAddress: 7, clientDetails: 7 }), empty);
});

test("device fingerprint and user ID are always null, so two null orders never match", () => {
  const a = ce30ElementsFromOrder({ customer: { email: "buyer@example.com" } });
  const b = ce30ElementsFromOrder({ customer: { email: "buyer@example.com" } });

  assert.equal(a.deviceId, null);
  assert.equal(a.userId, null);
  // Email is not one of Visa's four elements, so identical orders with nothing
  // else on them match on nothing at all.
  assert.deepEqual(matchingElements(a, b), []);
});

test("the elements this app can build today carry a dispute to eligibility once an IP exists", () => {
  // Documents the whole point of hashing rather than dropping: the assembled
  // input has to be capable of a positive verdict. With an IP present it is.
  const disputed = ce30ElementsFromOrder({
    shippingAddress: ADDRESS,
    clientDetails: { browserIp: "203.0.113.9" },
    customer: { email: "buyer@example.com" }
  });

  const prior = (orderId: string, daysAgo: number): Ce30Candidate => ({
    ...disputed,
    orderId,
    orderName: `#${orderId}`,
    processedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") - daysAgo * 86_400_000).toISOString(),
    hadDispute: false
  });

  const result = assessCe30(
    {
      conditionCode: "10.4",
      disputeDate: "2026-08-01T00:00:00.000Z",
      disputedTransaction: { ...disputed, orderId: "disputed" }
    },
    [prior("1001", 200), prior("1002", 150)]
  );

  assert.equal(result.eligible, true, result.blockers.join(" | "));
  assert.deepEqual(result.matchedElements, ["ipAddress", "shippingAddress"]);
  assert.deepEqual(
    result.qualifyingOrders.map((order) => order.orderName),
    ["#1001", "#1002"]
  );
});

test("without an IP the same history cannot qualify, however clean it looks", () => {
  // The honest state of this app today: no query selects clientDetails, so the
  // IP element is null on every order, and Visa requires IP or device among the
  // matches. This test exists so that fact is visible rather than discovered by
  // a merchant.
  const disputed = ce30ElementsFromOrder({
    shippingAddress: ADDRESS,
    customer: { email: "buyer@example.com" }
  });

  const prior = (orderId: string, daysAgo: number): Ce30Candidate => ({
    ...disputed,
    orderId,
    orderName: `#${orderId}`,
    processedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") - daysAgo * 86_400_000).toISOString(),
    hadDispute: false
  });

  const result = assessCe30(
    {
      conditionCode: "10.4",
      disputeDate: "2026-08-01T00:00:00.000Z",
      disputedTransaction: { ...disputed, orderId: "disputed" }
    },
    [prior("1001", 200), prior("1002", 150)]
  );

  assert.equal(result.eligible, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("Neither an IP address nor a device fingerprint")));
});
