/**
 * Outbound email, over Resend or SendGrid.
 *
 * Two providers because the right one is whichever you already have. An
 * established sending domain with warmed reputation beats anything about an API
 * surface, so an account the company already runs wins on the only axis that
 * matters - whether the mail arrives.
 *
 * For reference, at the time of writing: SendGrid retired its free plan on
 * 26 July 2025, so a new account starts at $20/month. Resend is free to 3,000
 * a month (100/day) and $20 for 50,000 after that. At the paid tier they are
 * the same price, so the decision is entirely about which account exists.
 *
 * Called through `fetch` rather than either SDK on purpose: it is one POST per
 * provider, and a dependency that ships its own transport is a dependency that
 * can break a build for no benefit.
 *
 * Silent when unconfigured. The behaviour this replaced was a dormant
 * `alertEmail` setting that looked like it sent mail and never did - a merchant
 * trusting a deadline warning that does not exist is worse off than one who
 * knows they have to check.
 */

export type EmailProvider = "resend" | "sendgrid";

export type EmailConfig = {
  provider: EmailProvider;
  apiKey: string;
  from: string;
};

export type EmailResult =
  | { sent: true; provider: EmailProvider; id: string | null }
  | { sent: false; reason: string; retryable: boolean };

export type EmailRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

const ENDPOINTS: Record<EmailProvider, string> = {
  resend: "https://api.resend.com/emails",
  sendgrid: "https://api.sendgrid.com/v3/mail/send"
};

/**
 * Which provider to use.
 *
 * An explicit EMAIL_PROVIDER wins, so a shop holding keys for both can choose.
 * Otherwise whichever key is present, SendGrid first - if someone has bothered
 * to set a SendGrid key it is because they already had the account.
 */
export function readEmailConfig(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const from = env.ALERT_EMAIL_FROM?.trim();
  if (!from) {
    return null;
  }

  const requested = env.EMAIL_PROVIDER?.trim().toLowerCase();
  const sendgridKey = env.SENDGRID_API_KEY?.trim();
  const resendKey = env.RESEND_API_KEY?.trim();

  if (requested === "sendgrid") {
    return sendgridKey ? { provider: "sendgrid", apiKey: sendgridKey, from } : null;
  }
  if (requested === "resend") {
    return resendKey ? { provider: "resend", apiKey: resendKey, from } : null;
  }

  if (sendgridKey) {
    return { provider: "sendgrid", apiKey: sendgridKey, from };
  }
  return resendKey ? { provider: "resend", apiKey: resendKey, from } : null;
}

/**
 * A minimal address check.
 *
 * Not a validator - nobody should write one of those. It only catches the
 * mistakes that would make the provider reject the whole batch: an empty value,
 * a missing @, or whitespace where an address should be.
 */
export function isPlausibleAddress(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  return trimmed.length > 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** Pure, so each provider's wire format is testable without a network call. */
export function buildEmailRequest(config: EmailConfig, payload: EmailPayload): EmailRequest {
  const to = payload.to.trim();

  if (config.provider === "sendgrid") {
    return {
      url: ENDPOINTS.sendgrid,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: config.from },
        subject: payload.subject,
        // Plain text first: SendGrid uses content order to decide which part a
        // client sees as the fallback, and an inverted order shows raw HTML in
        // text-only clients.
        content: [
          { type: "text/plain", value: payload.text },
          { type: "text/html", value: payload.html }
        ]
      })
    };
  }

  return {
    url: ENDPOINTS.resend,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.from,
      to: [to],
      subject: payload.subject,
      text: payload.text,
      html: payload.html
    })
  };
}

/**
 * Whether a failed send is worth another sweep.
 *
 * 429 and 5xx are transient. A 4xx is a configuration or address fault and will
 * fail identically forever, so retrying it just burns quota against a wall.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function sendEmail(
  options: EmailPayload & { config?: EmailConfig | null }
): Promise<EmailResult> {
  const config = options.config ?? readEmailConfig();

  if (!config) {
    return {
      sent: false,
      reason:
        "Email is not configured. Set ALERT_EMAIL_FROM plus either SENDGRID_API_KEY or RESEND_API_KEY.",
      retryable: false
    };
  }

  if (!isPlausibleAddress(options.to)) {
    return { sent: false, reason: "No usable recipient address.", retryable: false };
  }

  const request = buildEmailRequest(config, options);

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body
    });
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "Email request failed.",
      retryable: true
    };
  }

  // SendGrid answers 202 with an empty body; Resend answers 200 with JSON.
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      sent: false,
      retryable: isRetryableStatus(response.status),
      reason: `${config.provider} responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.`
    };
  }

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;
  return { sent: true, provider: config.provider, id: payload?.id ?? null };
}
