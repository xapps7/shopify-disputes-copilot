/**
 * Shopify dispute reason codes, and what each one actually requires.
 *
 * BUG THIS REPLACES: the checklist branched on `reason === "FRAUD"`, but sync
 * stores Shopify's enum verbatim and Shopify's value is `FRAUDULENT`. The
 * comparison never matched, so every fraudulent chargeback - the most common
 * and most defensible kind - silently got the generic fallback checklist.
 */

export const DISPUTE_REASON_CODES = [
  "FRAUDULENT",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION_CANCELED",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE",
  "UNRECOGNIZED",
  "CUSTOMER_INITIATED",
  "BANK_CANNOT_PROCESS",
  "DEBIT_NOT_AUTHORIZED",
  "INCORRECT_ACCOUNT_DETAILS",
  "INSUFFICIENT_FUNDS",
  "GENERAL",
  "UNKNOWN"
] as const;

export type DisputeReasonCode = (typeof DISPUTE_REASON_CODES)[number];

/** Tolerates legacy values ("FRAUD"), lower case, and spaces. */
export function normalizeReasonCode(raw: string | null | undefined): DisputeReasonCode {
  if (!raw) {
    return "UNKNOWN";
  }

  const value = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if ((DISPUTE_REASON_CODES as readonly string[]).includes(value)) {
    return value as DisputeReasonCode;
  }

  // Historical rows written before the enum was normalised.
  if (value === "FRAUD" || value === "FRAUDULENT_CHARGE") {
    return "FRAUDULENT";
  }
  if (value === "CHARGEBACK" || value === "INQUIRY") {
    return "GENERAL";
  }

  return "UNKNOWN";
}

export type ReasonProfile = {
  label: string;
  /** Plain language: what the issuing bank is actually asking the merchant to prove. */
  theQuestion: string;
  /** Evidence field keys that carry the most weight for this reason, strongest first. */
  priorityFields: string[];
  winnability: "strong" | "moderate" | "weak";
  winnabilityNote: string;
};

export const REASON_PROFILES: Record<DisputeReasonCode, ReasonProfile> = {
  FRAUDULENT: {
    label: "Fraudulent",
    theQuestion: "The cardholder says they did not authorise this purchase. You need to show the real cardholder received the goods.",
    priorityFields: ["shippingDocumentationFile", "shippingAddress", "accessActivityLog", "customerCommunicationFile", "uncategorizedText"],
    winnability: "strong",
    winnabilityNote: "Winnable with delivery proof to the billing address, especially where AVS and CVV matched."
  },
  PRODUCT_NOT_RECEIVED: {
    label: "Product not received",
    theQuestion: "The cardholder says the order never arrived. You need carrier proof that it did.",
    priorityFields: ["shippingDocumentationFile", "shippingAddress", "uncategorizedText", "customerCommunicationFile"],
    winnability: "strong",
    winnabilityNote: "Strong if you hold a delivery scan. Very weak if the order is still unfulfilled."
  },
  PRODUCT_UNACCEPTABLE: {
    label: "Product unacceptable",
    theQuestion: "The cardholder says the item was damaged, defective, or not as described. You need to show it matched the listing and that your policy was available.",
    priorityFields: ["uncategorizedText", "refundPolicyDisclosure", "refundRefusalExplanation", "customerCommunicationFile", "serviceDocumentationFile"],
    winnability: "moderate",
    winnabilityNote: "Turns on your policy disclosure and whether the customer contacted you before disputing."
  },
  SUBSCRIPTION_CANCELED: {
    label: "Subscription cancelled",
    theQuestion: "The cardholder says they cancelled before being charged. You need your cancellation terms and proof no cancellation was received.",
    priorityFields: ["cancellationPolicyDisclosure", "cancellationRebuttal", "cancellationPolicyFile", "customerCommunicationFile", "accessActivityLog"],
    winnability: "moderate",
    winnabilityNote: "Depends on being able to show the terms the customer accepted and continued usage after the claimed cancellation."
  },
  CREDIT_NOT_PROCESSED: {
    label: "Credit not processed",
    theQuestion: "The cardholder says you promised a refund and did not issue it. You need to show it was issued, or why it was legitimately refused.",
    priorityFields: ["refundRefusalExplanation", "refundPolicyDisclosure", "refundPolicyFile", "customerCommunicationFile", "uncategorizedText"],
    winnability: "moderate",
    winnabilityNote: "If a refund was issued, evidence of it usually resolves this quickly."
  },
  DUPLICATE: {
    label: "Duplicate charge",
    theQuestion: "The cardholder says they were billed twice for one purchase. You need to show two separate orders, or that the other charge was refunded.",
    priorityFields: ["uncategorizedText", "uncategorizedFile", "customerCommunicationFile"],
    winnability: "strong",
    winnabilityNote: "Usually decisive if you can show two distinct orders with different items or dates."
  },
  UNRECOGNIZED: {
    label: "Unrecognised charge",
    theQuestion: "The cardholder does not recognise the charge on their statement. Often your statement descriptor, not actual fraud.",
    priorityFields: ["uncategorizedText", "shippingDocumentationFile", "accessActivityLog", "customerCommunicationFile"],
    winnability: "strong",
    winnabilityNote: "Frequently resolved by showing the order alongside the statement descriptor the customer saw."
  },
  CUSTOMER_INITIATED: {
    label: "Customer initiated",
    theQuestion: "The cardholder raised a general complaint. Establish the order, delivery, and your policy position.",
    priorityFields: ["uncategorizedText", "shippingDocumentationFile", "customerCommunicationFile", "refundPolicyDisclosure"],
    winnability: "moderate",
    winnabilityNote: "Broad category - lead with delivery proof and your policy disclosure."
  },
  BANK_CANNOT_PROCESS: {
    label: "Bank cannot process",
    theQuestion: "An issuing-bank processing problem rather than a customer complaint.",
    priorityFields: ["uncategorizedText", "uncategorizedFile"],
    winnability: "weak",
    winnabilityNote: "Rarely contestable by the merchant - usually resolved between the banks."
  },
  DEBIT_NOT_AUTHORIZED: {
    label: "Debit not authorised",
    theQuestion: "The cardholder says the debit was not authorised. Show authorisation and delivery.",
    priorityFields: ["shippingDocumentationFile", "accessActivityLog", "uncategorizedText", "customerCommunicationFile"],
    winnability: "moderate",
    winnabilityNote: "Treat like a fraud claim - authorisation data and delivery proof carry the weight."
  },
  INCORRECT_ACCOUNT_DETAILS: {
    label: "Incorrect account details",
    theQuestion: "A payment routing or account-detail problem.",
    priorityFields: ["uncategorizedText", "uncategorizedFile"],
    winnability: "weak",
    winnabilityNote: "Rarely contestable by the merchant."
  },
  INSUFFICIENT_FUNDS: {
    label: "Insufficient funds",
    theQuestion: "The charge failed for funding reasons on the cardholder's side.",
    priorityFields: ["uncategorizedText"],
    winnability: "weak",
    winnabilityNote: "Rarely contestable by the merchant."
  },
  GENERAL: {
    label: "General",
    theQuestion: "No specific reason was given. Establish the order, delivery, and your policies.",
    priorityFields: ["uncategorizedText", "shippingDocumentationFile", "customerCommunicationFile", "refundPolicyDisclosure"],
    winnability: "moderate",
    winnabilityNote: "Build the broadest defensible record you can."
  },
  UNKNOWN: {
    label: "Unknown",
    theQuestion: "Shopify has not reported a reason code yet. Prepare the core evidence while you wait.",
    priorityFields: ["uncategorizedText", "shippingDocumentationFile", "customerCommunicationFile"],
    winnability: "moderate",
    winnabilityNote: "Re-check after the next sync - the reason code often arrives shortly after the dispute."
  }
};

export function getReasonProfile(raw: string | null | undefined): ReasonProfile & { code: DisputeReasonCode } {
  const code = normalizeReasonCode(raw);
  return { code, ...REASON_PROFILES[code] };
}
