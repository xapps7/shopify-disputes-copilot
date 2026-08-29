import test from "node:test";
import assert from "node:assert/strict";

import { buildDisputeProfitAndLoss } from "../lib/economics/dispute-pl.ts";
import { buildDisputePlCsv, disputePlFilename } from "../lib/economics/pl-export.ts";

const WINDOW = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };
const GENERATED_AT = new Date("2026-09-01T12:00:00Z");

function dispute(overrides: Partial<Parameters<typeof buildDisputeProfitAndLoss>[0][number]> = {}) {
  return {
    status: "LOST",
    disputeType: "CHARGEBACK",
    amount: 100,
    currencyCode: "USD",
    finalizedOn: new Date("2026-08-15T00:00:00Z"),
    ...overrides
  };
}

function csvFor(
  disputes: Parameters<typeof buildDisputeProfitAndLoss>[0],
  shopDomain = "acme.myshopify.com"
) {
  const pl = buildDisputeProfitAndLoss(disputes, WINDOW, "August 2026");
  return buildDisputePlCsv({
    shopDomain,
    periodLabel: "August 2026",
    periods: [pl],
    generatedAt: GENERATED_AT
  });
}

/** RFC 4180 rows. Split on CRLF so a stray LF inside a cell would be caught. */
function rows(csv: string): string[] {
  return csv.split("\r\n");
}

/** The data rows: everything between the header row and the first blank line. */
function dataRows(csv: string): string[] {
  const all = rows(csv);
  const headerIndex = all.findIndex((line) => line.startsWith('"Period","Currency"'));
  assert.ok(headerIndex >= 0, "the column header row should be present");

  const body: string[] = [];
  for (const line of all.slice(headerIndex + 1)) {
    if (line === "") {
      break;
    }
    body.push(line);
  }
  return body;
}

test("a won dispute still shows the fee it cost", () => {
  // The whole reason this file gets sent to a finance team: winning is not free.
  const csv = csvFor([dispute({ status: "WON", amount: 250 })]);
  const [line] = dataRows(csv);

  assert.equal(
    line,
    '"August 2026","USD",1,1,0,250.00,250.00,0.00,15.00,15.00,15.00,' +
      '"Published Shopify Payments fee for this currency"'
  );
  assert.match(csv, /charged whether you win or lose/);
});

test("money kept by winning is stated but never netted against net cost", () => {
  const csv = csvFor([dispute({ status: "WON", amount: 1000 }), dispute({ amount: 100 })]);
  const [line] = dataRows(csv);
  const cells = line.split(",");

  // kept = 1000, lost = 100, fees = 30, net = 130. Not 130 - 1000.
  assert.equal(cells[6], "1000.00");
  assert.equal(cells[10], "130.00");
  assert.match(csv, /NOT subtracted from net cost/);
});

test("currencies stay on separate rows and are never summed", () => {
  const csv = csvFor([
    dispute({ currencyCode: "USD", amount: 100 }),
    dispute({ currencyCode: "GBP", amount: 500 })
  ]);
  const body = dataRows(csv);

  assert.equal(body.length, 2);
  assert.ok(body.some((line) => line.includes('"GBP"')));
  assert.ok(body.some((line) => line.includes('"USD"')));
  // No total row anywhere - there is no exchange rate to build one from.
  assert.ok(!body.some((line) => line.toLowerCase().includes("total,")));
  assert.match(csv, /Currencies are never added together/);
});

test("a value beginning with = is neutralised rather than left executable", () => {
  // A shop domain is merchant-controlled, and this file gets opened in Excel.
  const csv = csvFor([dispute()], "=HYPERLINK(\"http://evil.test\",\"payroll\")");

  assert.match(csv, /"'=HYPERLINK/);
  // The dangerous form - a cell whose first character is = - must not appear.
  for (const line of rows(csv)) {
    for (const cell of line.split(",")) {
      assert.ok(!cell.startsWith('"='), `cell would run as a formula: ${cell}`);
    }
  }
});

test("the other formula triggers are neutralised too", () => {
  for (const prefix of ["+", "-", "@", "\t", "\r"]) {
    const csv = csvFor([dispute({ currencyCode: `${prefix}USD` })]);
    assert.ok(csv.includes(`"'${prefix}USD"`), `${JSON.stringify(prefix)} should be neutralised`);
  }
});

test("money columns are left as plain numbers so they can still be totalled", () => {
  // Neutralising a numeric cell would turn it into text and break the reader's
  // SUM, which is a worse failure than the one we are defending against.
  const [line] = dataRows(csvFor([dispute({ amount: 100 })]));
  const cells = line.split(",");

  assert.equal(cells[7], "100.00");
  assert.equal(cells[10], "115.00");
});

test("quotes and commas inside a field are escaped", () => {
  const csv = csvFor([dispute()], 'we, "the" shop.myshopify.com');

  assert.match(csv, /"we, ""the"" shop\.myshopify\.com"/);
  // Splitting the shop row on commas must not split the domain into two cells
  // outside its quotes: the quoted field keeps the comma inside itself.
  const shopRow = rows(csv).find((line) => line.startsWith('"Shop"'));
  assert.equal(shopRow, '"Shop","we, ""the"" shop.myshopify.com"');
});

test("an empty period produces a real statement, not an empty string", () => {
  // "We checked and it was zero" must not look like "we did not look".
  const csv = csvFor([]);
  const body = dataRows(csv);

  assert.ok(csv.length > 0);
  assert.equal(body.length, 1);
  assert.match(body[0], /^"August 2026","No settled disputes",0,0,0,0\.00/);
  assert.match(csv, /"Shop","acme\.myshopify\.com"/);
  assert.match(csv, /"Period","August 2026"/);
});

test("settled disputes with no finalisation date are counted, not dropped", () => {
  const csv = csvFor([dispute({ finalizedOn: null }), dispute({ finalizedOn: null })]);
  assert.match(csv, /"Settled disputes with no finalisation date, so in no month above",2/);
});

test("the undated count is not multiplied by the number of months reported", () => {
  // The same undated disputes are reported by every window, so summing them
  // would report one dispute twelve times in a twelve-month statement.
  const undated = [dispute({ finalizedOn: null })];
  const august = buildDisputeProfitAndLoss(undated, WINDOW, "August 2026");
  const july = buildDisputeProfitAndLoss(
    undated,
    { start: new Date("2026-07-01T00:00:00Z"), end: WINDOW.start },
    "July 2026"
  );

  const csv = buildDisputePlCsv({
    shopDomain: "acme.myshopify.com",
    periodLabel: "July 2026 to August 2026",
    periods: [august, july],
    generatedAt: GENERATED_AT
  });

  assert.match(csv, /"Settled disputes with no finalisation date, so in no month above",1/);
});

test("every row has the same number of cells as the column header", () => {
  const csv = csvFor([
    dispute({ currencyCode: "USD" }),
    dispute({ currencyCode: "GBP", status: "WON" })
  ]);
  const header = rows(csv).find((line) => line.startsWith('"Period","Currency"'));
  const expected = header?.split(",").length;

  for (const line of dataRows(csv)) {
    assert.equal(line.split(",").length, expected);
  }
});

test("a currency with no published fee is labelled as an estimate on its own row", () => {
  const [line] = dataRows(csvFor([dispute({ currencyCode: "ZAR", amount: 40 })]));
  assert.match(line, /"Estimated - no published Shopify fee for this currency, the US fee was used"/);
});

test("the filename carries the shop and the period and nothing that could shape a header", () => {
  assert.equal(
    disputePlFilename("acme.myshopify.com", "August 2026"),
    "chargeback-pl-acme-myshopify-com-august-2026.csv"
  );
  assert.equal(
    disputePlFilename('bad"; drop\r\n', "August 2026"),
    "chargeback-pl-bad-drop-august-2026.csv"
  );
  assert.equal(disputePlFilename("", ""), "chargeback-pl-shop-period.csv");
});
