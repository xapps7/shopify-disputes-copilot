/**
 * The documents that are the same on every dispute.
 *
 * A merchant's refund policy does not change between chargebacks. Neither does
 * their terms of service, their shipping policy, or the sentence explaining
 * where the customer saw those terms before paying. Asking for them once per
 * dispute is asking the same question twenty times a year and getting a worse
 * answer each time, because the fifth upload happens under a deadline.
 *
 * So they are collected once, at shop level, and offered to every dispute that
 * has a slot for them.
 *
 * Why this lives in `Merchant.settingsJson` rather than its own table: the
 * Prisma engine binaries cannot be fetched in this environment, so the client
 * cannot be regenerated and a new model cannot be used. A manifest of ten
 * documents is a few hundred bytes of JSON, the write path is already there,
 * and the alternative was not shipping it. The S3 objects are the real storage;
 * this is only the index.
 */

// A TYPE-only import on purpose. Type imports are erased before the module is
// executed, so this file stays runnable by the alias-free test runner while
// still being checked against the real slot keys at compile time.
import type { EvidenceFileSlotKey } from "@/lib/disputes/evidence-fields";

export type LibraryDocumentKind =
  | "REFUND_POLICY"
  | "CANCELLATION_POLICY"
  | "TERMS_OF_SERVICE"
  | "SHIPPING_POLICY"
  | "PROOF_OF_SERVICE"
  | "OTHER";

export type LibraryDocumentDefinition = {
  kind: LibraryDocumentKind;
  label: string;
  /** Why a merchant would keep this one on file, in one line. */
  why: string;
  /** The Shopify evidence slot this document is offered against. */
  slot: EvidenceFileSlotKey;
  /** The EvidenceItem category it behaves as, so slot matching stays one rule. */
  category: string;
};

/**
 * Ordered by how often a dispute actually calls for it, not alphabetically.
 * Refund policy first because `refundPolicyFile` is the slot most reason codes
 * reach for after delivery proof.
 */
export const LIBRARY_DOCUMENT_KINDS: LibraryDocumentDefinition[] = [
  {
    kind: "REFUND_POLICY",
    label: "Refund and return policy",
    why: "Asked for on credit-not-processed and product-unacceptable claims. Same file every time.",
    slot: "refundPolicyFile",
    category: "POLICY_DISCLOSURE"
  },
  {
    kind: "CANCELLATION_POLICY",
    label: "Cancellation terms",
    why: "Asked for whenever a subscription or a service is disputed.",
    slot: "cancellationPolicyFile",
    category: "POLICY_DISCLOSURE"
  },
  {
    kind: "TERMS_OF_SERVICE",
    label: "Terms of service",
    why: "Backs up any claim that the customer agreed to something at checkout.",
    slot: "uncategorizedFile",
    category: "OTHER"
  },
  {
    kind: "SHIPPING_POLICY",
    label: "Shipping and delivery policy",
    why: "Sets the delivery window an item-not-received claim is measured against.",
    slot: "uncategorizedFile",
    category: "OTHER"
  },
  {
    kind: "PROOF_OF_SERVICE",
    label: "Standard proof of service",
    why: "For services and digital goods: the template showing what was delivered and when.",
    slot: "serviceDocumentationFile",
    category: "SERVICE_DOCUMENTATION"
  },
  {
    kind: "OTHER",
    label: "Something else",
    why: "Anything else you attach to most disputes.",
    slot: "uncategorizedFile",
    category: "OTHER"
  }
];

export type LibraryDocument = {
  id: string;
  kind: LibraryDocumentKind;
  title: string;
  /** A storage reference, never a URL. Resolved to a signed link at read time. */
  storageRef: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export function getKindDefinition(kind: LibraryDocumentKind): LibraryDocumentDefinition {
  return LIBRARY_DOCUMENT_KINDS.find((entry) => entry.kind === kind) ?? LIBRARY_DOCUMENT_KINDS[LIBRARY_DOCUMENT_KINDS.length - 1];
}

export function isLibraryDocumentKind(value: unknown): value is LibraryDocumentKind {
  return LIBRARY_DOCUMENT_KINDS.some((entry) => entry.kind === value);
}

/**
 * Reads the manifest defensively.
 *
 * This value has been through `JSON.parse` on a column a human can edit, so
 * every field is checked. A malformed entry is dropped rather than crashing the
 * settings page, because a broken manifest must not be able to lock a merchant
 * out of the rest of their settings.
 */
export function parseLibraryDocuments(value: unknown): LibraryDocument[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const documents: LibraryDocument[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;

    if (
      typeof candidate.id !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.storageRef !== "string" ||
      !isLibraryDocumentKind(candidate.kind)
    ) {
      continue;
    }

    documents.push({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      storageRef: candidate.storageRef,
      mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : "",
      sizeBytes: typeof candidate.sizeBytes === "number" && Number.isFinite(candidate.sizeBytes) ? candidate.sizeBytes : 0,
      uploadedAt: typeof candidate.uploadedAt === "string" ? candidate.uploadedAt : ""
    });
  }

  return documents;
}

/**
 * One document per kind, except OTHER.
 *
 * Two refund policies on file is not a richer library, it is a question the
 * merchant has to answer again at every dispute - and Shopify's slot takes one
 * file, so the second could never be used anyway. Replacing is the right
 * behaviour; the old S3 object is left in place and swept by retention.
 */
export function withDocument(documents: LibraryDocument[], next: LibraryDocument): LibraryDocument[] {
  const singular = next.kind !== "OTHER";
  const kept = singular ? documents.filter((document) => document.kind !== next.kind) : documents.slice();

  return [...kept, next];
}

export function withoutDocument(documents: LibraryDocument[], id: string): LibraryDocument[] {
  return documents.filter((document) => document.id !== id);
}

export function findDocument(documents: LibraryDocument[], id: string): LibraryDocument | null {
  return documents.find((document) => document.id === id) ?? null;
}

/** The documents offered against a given Shopify file slot. */
export function documentsForSlot(documents: LibraryDocument[], slot: EvidenceFileSlotKey): LibraryDocument[] {
  return documents.filter((document) => getKindDefinition(document.kind).slot === slot);
}

/**
 * The standing text answers.
 *
 * `refundPolicyDisclosure` and `cancellationPolicyDisclosure` are the two
 * evidence fields whose correct answer is identical on every dispute: what the
 * policy says and where the customer saw it. Shopify shows this text to the
 * bank verbatim, so it is worth writing once, carefully, rather than five times
 * in a hurry.
 */
export type StandingStatements = {
  refundPolicyStatement: string;
  cancellationPolicyStatement: string;
};

export const emptyStandingStatements: StandingStatements = {
  refundPolicyStatement: "",
  cancellationPolicyStatement: ""
};

/**
 * How much of Shopify's 4 MB budget the standing documents would consume if
 * every one of them were attached to a single dispute.
 *
 * This matters because the merchant uploads these months before the dispute
 * that uses them. A 1.8 MB terms-of-service PDF is invisible today and leaves
 * almost no room for delivery proof in November - which is the file that
 * actually decides the case.
 */
export function standingBudget(documents: LibraryDocument[], totalBudgetBytes: number) {
  const usedBytes = documents.reduce((sum, document) => sum + document.sizeBytes, 0);

  return {
    usedBytes,
    remainingBytes: Math.max(0, totalBudgetBytes - usedBytes),
    /** Over half the budget spent on files that never decide a case. */
    crowded: usedBytes > totalBudgetBytes / 2
  };
}
