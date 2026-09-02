import test from "node:test";
import assert from "node:assert/strict";

import { renderTextToPdf } from "../lib/documents/pdf.ts";

function asString(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

/**
 * The packet used to be a .txt file stored in a column called `pdfUrl` and sold
 * to the merchant as a PDF. Shopify accepts PDF, PNG and JPEG only, so anyone
 * who trusted that label was rejected with a deadline running. These tests
 * exist so it can never quietly become a text file again.
 */

test("the output is a real PDF, not a text file wearing the name", () => {
  const pdf = renderTextToPdf("Order #1001 was delivered.");
  const raw = asString(pdf.bytes);

  assert.ok(raw.startsWith("%PDF-1.4"), "missing PDF header");
  assert.ok(raw.trimEnd().endsWith("%%EOF"), "missing EOF marker");
  assert.match(raw, /\/Type \/Catalog/);
  assert.match(raw, /\/BaseFont \/Helvetica/);
});

test("every cross-reference offset points at the object it claims", () => {
  // This is the one thing that must be exact. A PDF whose xref is a byte out
  // opens in some readers and fails in others - the worst outcome for a
  // document a bank has to read.
  const raw = asString(renderTextToPdf("Line one\nLine two\nLine three").bytes);

  const startxref = Number(/startxref\s+(\d+)/.exec(raw)?.[1]);
  assert.ok(Number.isFinite(startxref), "no startxref");
  assert.equal(raw.slice(startxref, startxref + 4), "xref");

  const entries = [...raw.slice(startxref).matchAll(/(\d{10}) 00000 n/g)];
  assert.ok(entries.length >= 4, "too few objects");

  entries.forEach((entry, index) => {
    const objectNumber = index + 1;
    const offset = Number(entry[1]);
    assert.ok(
      raw.startsWith(`${objectNumber} 0 obj`, offset),
      `object ${objectNumber} is not at the offset the xref gives`
    );
  });
});

test("paragraph breaks survive", () => {
  // The first version ran every line together, because the character filter
  // treated a newline as a glyph it had no font for and replaced it with "?".
  const raw = asString(renderTextToPdf("First para\n\nSecond para").bytes);

  assert.ok(!raw.includes("(First para?"), "newline was turned into a question mark");
  assert.match(raw, /\(First para\) Tj/);
  assert.match(raw, /\(Second para\) Tj/);
});

test("a long line is wrapped, not run off the page", () => {
  const long = "word ".repeat(200).trim();
  const raw = asString(renderTextToPdf(long).bytes);
  const drawn = [...raw.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]);

  assert.ok(drawn.length > 1, "nothing was wrapped");
  // Nothing near the raw input length: the page is only so wide.
  assert.ok(Math.max(...drawn.map((d) => d.length)) < 120);
});

test("a single word longer than a line is broken rather than lost", () => {
  // A tracking number or a URL. Losing the right-hand end off the page edge
  // would silently drop evidence.
  const raw = asString(renderTextToPdf("Z".repeat(400)).bytes);
  const drawn = [...raw.matchAll(/\((Z+)\) Tj/g)].map((m) => m[1]);

  assert.ok(drawn.length > 1, "the long word was not broken");
  assert.equal(drawn.join("").length, 400, "characters were lost while breaking");
});

test("parentheses and backslashes cannot end the string early", () => {
  const raw = asString(renderTextToPdf("Refund (see policy) \\ here").bytes);
  assert.match(raw, /\(Refund \\\(see policy\\\) \\\\ here\) Tj/);
});

test("smart quotes become straight quotes rather than question marks", () => {
  const raw = asString(renderTextToPdf("They said “thanks” and didn’t write again").bytes);
  assert.match(raw, /They said "thanks" and didn't write again/);
});

test("it pages, and reports how many", () => {
  const many = Array.from({ length: 300 }, (_, i) => `Line ${i}`).join("\n");
  const result = renderTextToPdf(many);

  assert.ok(result.pages > 1, "everything landed on one page");
  assert.equal(result.truncated, false);
  assert.match(asString(result.bytes), new RegExp(`/Count ${result.pages}`));
});

test("past the page cap it truncates, and says so in the document", () => {
  // Shopify rejects an evidence PDF over 50 pages. Stopping halfway without
  // saying so would let a merchant hand a bank an incomplete document.
  const many = Array.from({ length: 5000 }, (_, i) => `Line ${i}`).join("\n");
  const result = renderTextToPdf(many, { maxPages: 3 });

  assert.equal(result.pages, 3);
  assert.equal(result.truncated, true);
  assert.match(asString(result.bytes), /was cut to 3 pages/);
});

test("empty input still produces a valid one-page PDF", () => {
  const result = renderTextToPdf("");
  assert.equal(result.pages, 1);
  assert.ok(asString(result.bytes).startsWith("%PDF-1.4"));
});
