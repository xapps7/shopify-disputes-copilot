/**
 * Shopify's dispute evidence form, modelled field by field.
 *
 * The packet used to be one text blob containing things Shopify never asks for
 * (shop domain, statement descriptor, support phone) and omitting six fields it
 * does. This module is the mapping to `ShopifyPaymentsDisputeEvidenceUpdateInput`,
 * so what the merchant sees matches the form they are filling in, one field at a
 * time - and so enabling API submission later is a mapping change, not a rewrite.
 *
 * https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ShopifyPaymentsDisputeEvidenceUpdateInput
 */

export type EvidenceFieldKey =
  | "customerFirstName"
  | "customerLastName"
  | "customerEmailAddress"
  | "shippingAddress"
  | "accessActivityLog"
  | "refundPolicyDisclosure"
  | "refundRefusalExplanation"
  | "cancellationPolicyDisclosure"
  | "cancellationRebuttal"
  | "uncategorizedText";

export type EvidenceFileSlotKey =
  | "shippingDocumentationFile"
  | "customerCommunicationFile"
  | "refundPolicyFile"
  | "cancellationPolicyFile"
  | "serviceDocumentationFile"
  | "uncategorizedFile";

/** Shopify accepts .png, .jpeg and .pdf only, and 4 MB TOTAL across every slot. */
export const MAX_TOTAL_EVIDENCE_BYTES = 4 * 1024 * 1024;

/**
 * And 2 MB per file, which is a separate rule and a stricter one.
 *
 * We used to check only the 4 MB total, so a single 3 MB scan passed every
 * check here and was rejected by Shopify at submission - the worst possible
 * moment to find out. Shopify's help page states both caps:
 * "Ensure each evidence file doesn't exceed 2 MB" and "Ensure that your
 * combined evidence files don't exceed 4 MB".
 * https://help.shopify.com/en/manual/payments/chargebacks/resolve-chargeback
 */
export const MAX_SINGLE_EVIDENCE_BYTES = 2 * 1024 * 1024;

export const ALLOWED_EVIDENCE_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

/**
 * Shopify's other file rules, which no API error will ever tell you about.
 * Stated once here so the same wording reaches the uploader, the library, and
 * the readiness copy.
 */
export const SHOPIFY_FILE_RULES = [
  "PDF, PNG or JPEG only.",
  "2 MB per file, and 4 MB across the whole response.",
  "PDFs must be PDF/A and under 50 pages. Merge multiple PDFs into one.",
  "One file per slot. No audio, no video, and no links to pages held elsewhere."
] as const;

export type FieldSource = "auto" | "drafted" | "merchant";

export type EvidenceFieldDefinition = {
  key: EvidenceFieldKey;
  label: string;
  /** How the merchant should think about it, in their words not Shopify's. */
  prompt: string;
  /** Shown when empty, so the box is never a blank stare. */
  placeholder: string;
  source: FieldSource;
  multiline: boolean;
};

export const EVIDENCE_FIELDS: EvidenceFieldDefinition[] = [
  {
    key: "customerFirstName",
    label: "Customer first name",
    prompt: "Taken from the order. Shopify matches this against the cardholder record.",
    placeholder: "Not available - needs protected customer data access",
    source: "auto",
    multiline: false
  },
  {
    key: "customerLastName",
    label: "Customer last name",
    prompt: "Taken from the order.",
    placeholder: "Not available - needs protected customer data access",
    source: "auto",
    multiline: false
  },
  {
    key: "customerEmailAddress",
    label: "Customer email",
    prompt: "Taken from the order. Used to tie communication records to the cardholder.",
    placeholder: "Not available - needs protected customer data access",
    source: "auto",
    multiline: false
  },
  {
    key: "shippingAddress",
    label: "Shipping address",
    prompt: "Taken from the order. Matching this to the billing address is the single strongest signal on a fraud claim.",
    placeholder: "No shipping address on this order",
    source: "auto",
    multiline: true
  },
  {
    key: "accessActivityLog",
    label: "Account and access activity",
    prompt:
      "Evidence the real cardholder was active: sign-ins, IP addresses, download or delivery-tracking views, repeat orders from the same account.",
    placeholder:
      "Example: Customer signed in on 2 Jul 2026 from 203.0.113.4, opened the tracking link twice, and placed a second order on the same account on 14 Jul.",
    source: "drafted",
    multiline: true
  },
  {
    key: "refundPolicyDisclosure",
    label: "Refund policy disclosure",
    prompt:
      "Not a link - describe what the policy says and where the customer saw it before paying. Shopify shows this text to the bank.",
    placeholder:
      "Example: Our 30-day refund policy is linked in the checkout footer and was shown on the product page. The customer accepted it at checkout on 2 Jul 2026.",
    source: "drafted",
    multiline: true
  },
  {
    key: "refundRefusalExplanation",
    label: "Why a refund was refused",
    prompt: "Only if you declined a refund. Explain the specific reason, against the policy above.",
    placeholder:
      "Example: The return window closed on 19 Jul 2026, 14 days after delivery. The customer first contacted us on 28 Jul.",
    source: "merchant",
    multiline: true
  },
  {
    key: "cancellationPolicyDisclosure",
    label: "Cancellation policy disclosure",
    prompt: "For subscriptions and services: what the cancellation terms say and where the customer agreed to them.",
    placeholder:
      "Example: Cancellation requires 7 days notice before renewal, shown at sign-up and in every renewal reminder email.",
    source: "drafted",
    multiline: true
  },
  {
    key: "cancellationRebuttal",
    label: "Response to the cancellation claim",
    prompt: "Only if the customer claims they cancelled. Show that no cancellation was received, or that it came too late.",
    placeholder:
      "Example: No cancellation request exists in our records before the 3 Aug renewal. The account was used on 5 Aug.",
    source: "merchant",
    multiline: true
  },
  {
    key: "uncategorizedText",
    label: "Your response",
    prompt:
      "The main argument. State plainly what was ordered, that it was delivered, and why the charge is valid. Keep it factual - the reviewer spends under a minute on this.",
    placeholder: "",
    source: "drafted",
    multiline: true
  }
];

export type EvidenceFileSlotDefinition = {
  key: EvidenceFileSlotKey;
  label: string;
  prompt: string;
  /** EvidenceItem categories that belong in this Shopify slot. */
  categories: string[];
};

/**
 * Shopify takes exactly ONE file per slot. Our EvidenceItem model is
 * one-to-many, so several uploads can compete for the same slot - the UI has to
 * make the merchant choose rather than silently dropping the rest.
 */
export const EVIDENCE_FILE_SLOTS: EvidenceFileSlotDefinition[] = [
  {
    key: "shippingDocumentationFile",
    label: "Shipping and delivery proof",
    prompt: "Carrier label, tracking history, or proof-of-delivery scan. One file - combine pages into a single PDF.",
    categories: ["SHIPPING_DOCUMENTATION", "DELIVERY_CONFIRMATION"]
  },
  {
    key: "customerCommunicationFile",
    label: "Customer communication",
    prompt: "Emails, chat transcripts, or support tickets with this customer about this order.",
    categories: ["CUSTOMER_COMMUNICATION"]
  },
  {
    key: "refundPolicyFile",
    label: "Refund policy",
    prompt: "A screenshot or PDF of the refund policy as the customer saw it.",
    categories: ["POLICY_DISCLOSURE", "REFUND_PROOF"]
  },
  {
    key: "cancellationPolicyFile",
    label: "Cancellation policy",
    prompt: "The cancellation terms as presented at sign-up or checkout.",
    categories: ["POLICY_DISCLOSURE"]
  },
  {
    key: "serviceDocumentationFile",
    label: "Service documentation",
    prompt: "For services or digital goods: proof the service was provided or accessed.",
    categories: ["SERVICE_DOCUMENTATION"]
  },
  {
    key: "uncategorizedFile",
    label: "Anything else",
    prompt: "Product photos, order records, or anything that does not fit the slots above.",
    categories: ["PRODUCT_PROOF", "ACCOUNT_ACTIVITY", "OTHER"]
  }
];

/* ------------------------------------------------------------------ *
 * Drafting
 * ------------------------------------------------------------------ */

export type DraftContext = {
  /** From getReasonProfile(): the human label, e.g. "Fraudulent". */
  reasonLabel: string;
  /** From getReasonProfile(): what the bank is actually asking. */
  reasonQuestion: string;
  orderName: string | null;
  orderTotal: string | null;
  currencyCode: string | null;
  customerName: string | null;
  customerEmail: string | null;
  shippingAddress: string | null;
  fulfillmentStatus: string | null;
  trackingSummaries: string[];
  lineItemSummaries: string[];
  refundPolicyUrl: string;
  returnPolicyUrl: string;
  supportEmail: string;
  statementDescriptor: string;
  orderPlacedAt: string | null;
  /**
   * The merchant's standing answers, written once at shop level.
   *
   * When present these WIN over the generated sentence. A merchant who has
   * taken the trouble to write what their policy says and where the customer
   * saw it has produced better evidence than any template built from a URL, and
   * re-deriving it per dispute would quietly throw that work away.
   */
  refundPolicyStatement?: string;
  cancellationPolicyStatement?: string;
};

function joinSentences(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" ");
}

/**
 * Produces a first draft for every field the app can reasonably infer. The
 * merchant edits from here rather than starting at a blank textarea - which is
 * the single biggest reason evidence goes in thin or late.
 */
export function draftEvidenceFields(context: DraftContext): Partial<Record<EvidenceFieldKey, string>> {
  const order = context.orderName ?? "this order";
  const money =
    context.orderTotal && context.currencyCode ? `${context.currencyCode} ${context.orderTotal}` : null;

  const drafts: Partial<Record<EvidenceFieldKey, string>> = {};

  if (context.customerName) {
    const [first, ...rest] = context.customerName.split(" ");
    drafts.customerFirstName = first;
    if (rest.length > 0) {
      drafts.customerLastName = rest.join(" ");
    }
  }

  if (context.customerEmail) {
    drafts.customerEmailAddress = context.customerEmail;
  }

  if (context.shippingAddress) {
    drafts.shippingAddress = context.shippingAddress;
  }

  const delivery =
    context.trackingSummaries.length > 0
      ? `It was shipped and tracked: ${context.trackingSummaries.join("; ")}.`
      : context.fulfillmentStatus
        ? `Fulfilment status at the time of this response: ${context.fulfillmentStatus}.`
        : null;

  drafts.uncategorizedText = joinSentences([
    `Order ${order}${money ? ` for ${money}` : ""}${
      context.orderPlacedAt ? ` was placed on ${context.orderPlacedAt}` : " was placed"
    }.`,
    context.lineItemSummaries.length > 0 ? `It contained ${context.lineItemSummaries.join(", ")}.` : null,
    delivery,
    context.shippingAddress ? `It was shipped to the address on file: ${context.shippingAddress}.` : null,
    `This dispute was filed as "${context.reasonLabel}". ${context.reasonQuestion}`,
    context.statementDescriptor
      ? `The charge appears on the cardholder's statement as "${context.statementDescriptor}".`
      : null,
    context.supportEmail ? `The customer did not contact ${context.supportEmail} before disputing.` : null
  ]);

  if (context.refundPolicyStatement?.trim()) {
    drafts.refundPolicyDisclosure = context.refundPolicyStatement.trim();
  } else if (context.refundPolicyUrl || context.returnPolicyUrl) {
    drafts.refundPolicyDisclosure = joinSentences([
      `Our refund and return policy is published at ${context.refundPolicyUrl || context.returnPolicyUrl}`,
      "and is linked from the storefront footer and the checkout page, so it was available to the customer before payment.",
      context.orderPlacedAt ? `The customer accepted it when placing this order on ${context.orderPlacedAt}.` : null
    ]);
  }

  if (context.cancellationPolicyStatement?.trim()) {
    drafts.cancellationPolicyDisclosure = context.cancellationPolicyStatement.trim();
  }

  if (context.fulfillmentStatus || context.trackingSummaries.length > 0) {
    drafts.accessActivityLog = joinSentences([
      context.customerEmail ? `Order placed from the account ${context.customerEmail}.` : "Order placed from the customer account on file.",
      context.orderPlacedAt ? `Order date ${context.orderPlacedAt}.` : null,
      context.trackingSummaries.length > 0
        ? `Tracking was made available to the customer: ${context.trackingSummaries.join("; ")}.`
        : null,
      "Add sign-in timestamps, IP addresses, or tracking-page views if you have them - they carry real weight on fraud claims."
    ]);
  }

  return drafts;
}

export type EvidenceFieldState = {
  key: EvidenceFieldKey;
  label: string;
  prompt: string;
  placeholder: string;
  value: string;
  source: FieldSource;
  /** True when this reason code makes the field one of the decisive ones. */
  priority: boolean;
  status: "ready" | "needed" | "optional";
};

export function buildEvidenceFieldStates(
  /** From getReasonProfile().priorityFields - the fields that decide THIS reason code. */
  priorityFields: readonly string[],
  saved: Partial<Record<EvidenceFieldKey, string>>,
  drafts: Partial<Record<EvidenceFieldKey, string>>
): EvidenceFieldState[] {
  const priorityKeys = new Set(priorityFields);

  return EVIDENCE_FIELDS.map((definition) => {
    const value = (saved[definition.key] ?? drafts[definition.key] ?? "").trim();
    const priority = priorityKeys.has(definition.key);

    return {
      key: definition.key,
      label: definition.label,
      prompt: definition.prompt,
      placeholder: definition.placeholder,
      value,
      source: saved[definition.key] ? "merchant" : definition.source,
      priority,
      status: value ? "ready" : priority ? "needed" : "optional"
    };
  });
}

/**
 * Readiness across the TEXT fields only.
 *
 * Priority file slots are reported separately by the UI, because "3 of 3 text
 * fields written" and "no delivery proof attached" are different problems with
 * different fixes. Rolling them into one percentage is how the old score got to
 * "100% ready" off four irrelevant uploads.
 */
export function evidenceReadiness(states: EvidenceFieldState[]) {
  const priority = states.filter((state) => state.priority);
  const ready = priority.filter((state) => state.status === "ready");

  return {
    readyCount: ready.length,
    priorityCount: priority.length,
    percent: priority.length === 0 ? 0 : Math.round((ready.length / priority.length) * 100),
    missing: priority.filter((state) => state.status !== "ready").map((state) => state.label)
  };
}
