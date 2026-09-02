/**
 * A PDF writer, from scratch, for plain text.
 *
 * WHY THIS EXISTS. The evidence packet was a `.txt` file stored in a column
 * called `pdfUrl` and described to the merchant as a PDF. Shopify accepts PDF,
 * PNG and JPEG only, so anyone who trusted that label uploaded it to Shopify
 * and was rejected with a deadline running.
 *
 * WHY NOT A LIBRARY. The npm registry is unreachable from this environment and
 * both build paths (`Dockerfile` and `apprunner.yaml`) run `npm ci` strictly
 * from `package-lock.json`, which cannot be regenerated without the registry.
 * So pdfkit, jsPDF and headless-Chrome approaches are not "discouraged" here,
 * they are unavailable. Puppeteer would also be the wrong tool regardless: a
 * Chromium download to typeset one text document.
 *
 * WHAT A PDF ACTUALLY IS. A byte-offset-indexed container of numbered objects.
 * A text-only document needs a catalog, a page tree, one of the fourteen fonts
 * every reader ships with, a content stream per page, and a cross-reference
 * table giving the exact byte offset of every object. Nothing here is clever;
 * it is careful. The one thing that must be exact is the offsets - a PDF whose
 * xref is a byte out will open in some readers and fail in others, which is the
 * worst possible outcome for a document a bank has to read.
 *
 * WHAT IT DOES NOT DO. No images, no embedded fonts, no PDF/A. PDF/A needs an
 * embedded font, an ICC output intent and XMP metadata; Helvetica is one of the
 * base fourteen and is referenced, not embedded, so this is a valid PDF 1.4 and
 * not PDF/A. Shopify's help pages ask for PDF/A. In practice its evidence
 * upload accepts ordinary PDFs, and this is a deliberate, stated risk rather
 * than an oversight - settle it with one test upload against a dev store.
 */

/** US Letter, in PostScript points. 72 points to the inch. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;

const DEFAULT_FONT_SIZE = 10;
/** Line height as a multiple of the font size. 1.35 reads well at 10pt. */
const LEADING_RATIO = 1.35;

/**
 * Helvetica character widths, in 1/1000 of an em, for printable ASCII.
 *
 * Straight from Adobe's Helvetica.afm. This is what makes wrapping exact rather
 * than a guess: Helvetica is proportional, so a fixed characters-per-line
 * estimate either wastes half the page or runs text off the right edge, and the
 * second one silently loses evidence.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584
};

/** Anything unmeasured gets the width of a lowercase n. Close enough, and never zero. */
const FALLBACK_WIDTH = 556;

/**
 * Characters that routinely arrive from a copy-pasted email or a word
 * processor and have no WinAnsi equivalent worth risking. Mapped rather than
 * dropped, because a customer's message reading `dont` instead of `don't` is a
 * small thing that makes a merchant distrust the whole document.
 */
const TRANSLITERATIONS: Record<string, string> = {
  "‘": "'", "’": "'", "‚": ",", "‛": "'",
  "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "−": "-",
  "…": "...", " ": " ", "•": "-", "·": "-",
  "‹": "<", "›": ">", "«": "<<", "»": ">>",
  "™": "(TM)", "®": "(R)", "©": "(C)"
};

/** WinAnsiEncoding is a superset of Latin-1 for our purposes: one byte per glyph. */
function toWinAnsi(text: string): string {
  let out = "";

  for (const char of text) {
    const replacement = TRANSLITERATIONS[char];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }

    const code = char.codePointAt(0) ?? 63;

    if (code === 10) {
      // Line breaks are structure, not glyphs, and the caller splits on them
      // after this runs. An earlier version dropped them into the
      // "no glyph for this" branch below, so every paragraph break in the
      // document became a literal question mark and the whole packet rendered
      // as one unreadable block.
      out += "\n";
    } else if (code === 9) {
      out += "    ";
    } else if (code >= 32 && code <= 126) {
      out += char;
    } else if (code >= 160 && code <= 255) {
      out += char;
    } else {
      // Anything else - emoji, CJK, control characters - has no glyph in this
      // font. A question mark is visibly a gap; a silently dropped character
      // changes what the document says.
      out += "?";
    }
  }

  return out;
}

function measure(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += HELVETICA_WIDTHS[char] ?? FALLBACK_WIDTH;
  }
  return (width * fontSize) / 1000;
}

/**
 * Wraps one paragraph to the usable width.
 *
 * A word longer than a whole line - a URL, a tracking number, a base64 blob -
 * is broken mid-word rather than allowed to overflow. Losing the right-hand end
 * of a tracking number off the edge of the page is exactly the failure this
 * document cannot afford.
 */
function wrapLine(text: string, fontSize: number, usableWidth: number): string[] {
  if (text.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/ +/)) {
    const candidate = current ? `${current} ${word}` : word;

    if (measure(candidate, fontSize) <= usableWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (measure(word, fontSize) <= usableWidth) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const char of word) {
      if (measure(chunk + char, fontSize) > usableWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

/** Parentheses and backslashes end a PDF string early if they are not escaped. */
function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** PDF wants D:YYYYMMDDHHmmSS with an explicit UTC marker. */
function pdfDate(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `D:${when.getUTCFullYear()}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}` +
    `${pad(when.getUTCHours())}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}Z`
  );
}

export type PdfOptions = {
  /** Shown in the reader's title bar and in file properties. */
  title?: string;
  fontSize?: number;
  /** Hard ceiling on pages. Shopify rejects an evidence PDF over 50. */
  maxPages?: number;
  /** Overridable so tests can pin the timestamp. */
  now?: Date;
};

export type PdfResult = {
  bytes: Uint8Array;
  pages: number;
  /** True when the text was cut to fit `maxPages`. */
  truncated: boolean;
};

/**
 * Lays text out and returns the finished PDF.
 *
 * Truncation is reported rather than silent, and the document says so on its
 * own last page. A merchant handing a bank a document that quietly stops
 * halfway is worse off than one who knows to attach the rest.
 */
export function renderTextToPdf(text: string, options: PdfOptions = {}): PdfResult {
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const maxPages = Math.max(1, options.maxPages ?? 50);
  const leading = fontSize * LEADING_RATIO;
  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  const linesPerPage = Math.max(1, Math.floor((PAGE_HEIGHT - MARGIN * 2) / leading));

  const source = toWinAnsi((text ?? "").replace(/\r\n?/g, "\n"));

  const allLines: string[] = [];
  for (const paragraph of source.split("\n")) {
    allLines.push(...wrapLine(paragraph, fontSize, usableWidth));
  }

  const capacity = linesPerPage * maxPages;
  let truncated = false;
  let lines = allLines;

  if (allLines.length > capacity) {
    truncated = true;
    // Two lines back, to make room for saying so.
    lines = allLines.slice(0, capacity - 2);
    lines.push("");
    lines.push(
      `[This document was cut to ${maxPages} pages. ${allLines.length - (capacity - 2)} more lines were not included.]`
    );
  }

  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) {
    pages.push([""]);
  }

  /* ----------------------------------------------------------- assembly --- */

  // Built as a latin1 string so one character is exactly one byte, which is
  // what makes the running offset below a true byte offset.
  const chunks: string[] = [];
  let offset = 0;
  const offsets: number[] = [];

  const push = (value: string) => {
    chunks.push(value);
    offset += value.length;
  };

  const startObject = (id: number) => {
    offsets[id] = offset;
    push(`${id} 0 obj\n`);
  };

  push("%PDF-1.4\n");
  // A comment of high bytes marks the file as binary, so a transfer that would
  // mangle line endings is treated as binary by anything that checks.
  push("%\xE2\xE3\xCF\xD3\n");

  const FIRST_PAGE_OBJECT = 5;
  const pageIds = pages.map((_, index) => FIRST_PAGE_OBJECT + index * 2);
  const contentIds = pages.map((_, index) => FIRST_PAGE_OBJECT + index * 2 + 1);
  const totalObjects = 4 + pages.length * 2;

  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);

  startObject(3);
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");

  startObject(4);
  push(
    `<< /Title (${escapePdfText(toWinAnsi(options.title ?? "Evidence packet"))}) ` +
      `/Producer (Disputes Co-Pilot) /CreationDate (${pdfDate(options.now ?? new Date())}) >>\nendobj\n`
  );

  pages.forEach((pageLines, index) => {
    const contentParts = [
      "BT",
      `/F1 ${fontSize} Tf`,
      `${leading.toFixed(2)} TL`,
      `${MARGIN} ${(PAGE_HEIGHT - MARGIN - fontSize).toFixed(2)} Td`
    ];

    pageLines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        contentParts.push("T*");
      }
      contentParts.push(`(${escapePdfText(line)}) Tj`);
    });

    contentParts.push("ET");
    const stream = contentParts.join("\n");

    startObject(pageIds[index]);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[index]} 0 R >>\nendobj\n`
    );

    startObject(contentIds[index]);
    push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });

  const xrefOffset = offset;
  push(`xref\n0 ${totalObjects + 1}\n`);
  // Every entry is exactly 20 bytes. Readers index into this table by
  // multiplication, so a single missing byte shifts every object after it.
  push("0000000000 65535 f \n");
  for (let id = 1; id <= totalObjects; id += 1) {
    push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  }

  push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R /Info 4 0 R >>\n`);
  push(`startxref\n${xrefOffset}\n%%EOF\n`);

  return {
    bytes: Uint8Array.from(Buffer.from(chunks.join(""), "latin1")),
    pages: pages.length,
    truncated
  };
}
