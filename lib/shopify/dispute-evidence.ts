import { createShopifyAdminClient } from "@/lib/shopify/client";
import { extractGraphqlErrors, graphqlErrorMessages } from "@/lib/shopify/errors";

/**
 * Writing evidence into Shopify's dispute form.
 *
 * Two things to know, both verified against Shopify's docs and developer forum:
 *
 * 1. `disputeEvidenceUpdate` WORKS - text and files persist on the dispute. It
 *    is only `submitEvidence: true` that is silently ignored (open Shopify bug,
 *    acknowledged by staff, still unresolved as of 29 Jul 2026). So we populate
 *    the form and leave the merchant to press Submit - which is exactly what
 *    Shopify staff recommend.
 * 2. The scopes are RESTRICTED. `write_shopify_payments_dispute_evidences`
 *    cannot even be declared in shopify.app.toml until Shopify approves the app
 *    - declaring it early makes `shopify app deploy` fail. So this capability is
 *    detected at runtime from the granted scopes and stays dormant until then.
 */

export const EVIDENCE_WRITE_SCOPE = "write_shopify_payments_dispute_evidences";
export const EVIDENCE_FILE_WRITE_SCOPE = "write_shopify_payments_dispute_file_uploads";

const GRANTED_SCOPES_QUERY = `#graphql
  query GrantedScopes {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

const DISPUTE_EVIDENCE_QUERY = `#graphql
  query DisputeEvidence($id: ID!) {
    dispute(id: $id) {
      id
      status
      evidenceDueBy
      evidenceSentOn
      disputeEvidence {
        id
        submitted
      }
    }
  }
`;

const DISPUTE_EVIDENCE_UPDATE = `#graphql
  mutation DisputeEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
    disputeEvidenceUpdate(id: $id, input: $input) {
      disputeEvidence {
        id
        submitted
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export type PushCapability = {
  canPush: boolean;
  reason: string | null;
};

/**
 * Whether this install can write evidence. Returns a merchant-readable reason
 * when it cannot, because "the button is greyed out" with no explanation is
 * worse than not having the button.
 */
export async function getEvidencePushCapability(
  client: ReturnType<typeof createShopifyAdminClient>
): Promise<PushCapability> {
  if (process.env.ENABLE_EVIDENCE_PUSH !== "true") {
    return {
      canPush: false,
      reason:
        "Writing evidence straight into Shopify is turned off for this install. It needs restricted Shopify scopes that are granted app by app."
    };
  }

  const response = await client.request(GRANTED_SCOPES_QUERY);
  if (extractGraphqlErrors(response).length > 0) {
    return { canPush: false, reason: "Could not read this app's granted Shopify scopes." };
  }

  const scopes = (
    (response.data as { currentAppInstallation?: { accessScopes?: Array<{ handle?: string | null }> } } | undefined)
      ?.currentAppInstallation?.accessScopes ?? []
  )
    .map((scope) => scope.handle)
    .filter((handle): handle is string => Boolean(handle));

  if (!scopes.includes(EVIDENCE_WRITE_SCOPE)) {
    return {
      canPush: false,
      reason:
        "Shopify has not granted this app permission to write dispute evidence. That scope is restricted and is requested from Shopify Support app by app. Until then, copy each field into the admin."
    };
  }

  return { canPush: true, reason: null };
}

export type EvidenceTarget = {
  evidenceId: string;
  alreadySubmitted: boolean;
  evidenceSentOn: string | null;
};

export async function findDisputeEvidenceTarget(
  client: ReturnType<typeof createShopifyAdminClient>,
  shopifyDisputeId: string
): Promise<EvidenceTarget | { error: string }> {
  const response = await client.request(DISPUTE_EVIDENCE_QUERY, { variables: { id: shopifyDisputeId } });
  const errors = graphqlErrorMessages(response);

  if (errors.length > 0) {
    return { error: errors.join(" | ") };
  }

  const dispute = (
    response.data as
      | {
          dispute?: {
            evidenceSentOn?: string | null;
            disputeEvidence?: { id?: string | null; submitted?: boolean | null } | null;
          } | null;
        }
      | undefined
  )?.dispute;

  const evidenceId = dispute?.disputeEvidence?.id;

  if (!evidenceId) {
    return { error: "Shopify has no evidence record for this dispute yet." };
  }

  return {
    evidenceId,
    alreadySubmitted: Boolean(dispute?.disputeEvidence?.submitted),
    evidenceSentOn: dispute?.evidenceSentOn ?? null
  };
}

export type PushResult =
  | { ok: true; evidenceId: string }
  | { ok: false; message: string; userErrors?: string[] };

/**
 * Writes the prepared response into Shopify's evidence form.
 *
 * Deliberately never sets `submitEvidence`. Beyond the bug, submission is
 * irreversible - "After evidence is submitted, you can't make changes or
 * provide additional information" - so that decision stays with the merchant.
 */
export async function pushEvidenceToShopify(
  client: ReturnType<typeof createShopifyAdminClient>,
  evidenceId: string,
  input: Record<string, unknown>
): Promise<PushResult> {
  if (Object.keys(input).length === 0) {
    return { ok: false, message: "Nothing to send - the response is empty." };
  }

  const response = await client.request(DISPUTE_EVIDENCE_UPDATE, {
    variables: { id: evidenceId, input }
  });

  const transportErrors = graphqlErrorMessages(response);
  if (transportErrors.length > 0) {
    return { ok: false, message: transportErrors.join(" | ") };
  }

  const payload = (
    response.data as
      | {
          disputeEvidenceUpdate?: {
            disputeEvidence?: { id?: string | null } | null;
            userErrors?: Array<{ field?: string[] | null; message?: string | null }>;
          } | null;
        }
      | undefined
  )?.disputeEvidenceUpdate;

  const userErrors = (payload?.userErrors ?? [])
    .map((error) => [error.field?.join("."), error.message].filter(Boolean).join(": "))
    .filter(Boolean);

  if (userErrors.length > 0) {
    return { ok: false, message: "Shopify rejected part of the response.", userErrors };
  }

  return { ok: true, evidenceId: payload?.disputeEvidence?.id ?? evidenceId };
}

/** Maps our stored field values onto Shopify's input, dropping anything empty. */
export function buildEvidenceInput(fields: Record<string, string | null | undefined>) {
  const TEXT_KEYS = [
    "customerFirstName",
    "customerLastName",
    "customerEmailAddress",
    "accessActivityLog",
    "refundPolicyDisclosure",
    "refundRefusalExplanation",
    "cancellationPolicyDisclosure",
    "cancellationRebuttal",
    "uncategorizedText"
  ] as const;

  const input: Record<string, unknown> = {};

  for (const key of TEXT_KEYS) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) {
      input[key] = value.trim();
    }
  }

  // shippingAddress is a MailingAddressInput, not a string, and Shopify already
  // holds it from the order - sending our flattened version would be worse data.
  return input;
}
