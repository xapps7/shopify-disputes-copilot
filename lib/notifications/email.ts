/**
 * Outbound email, over Resend's REST API.
 *
 * Called through `fetch` rather than the SDK on purpose: it is one POST, and a
 * dependency that ships its own transport is a dependency that can break the
 * edge build for no benefit.
 *
 * Silent when unconfigured. The previous behaviour in this app was a dormant
 * `alertEmail` setting that looked like it sent mail and never did - a merchant
 * trusting a deadline warning that does not exist is worse off than one who
 * knows they have to check.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: string; retryable: boolean };

export type EmailConfig = {
  apiKey: string;
  from: string;
};

/** Null when email is not configured, so callers can say so rather than guess. */
export function readEmailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ALERT_EMAIL_FROM?.trim();

  return apiKey && from ? { apiKey, from } : null;
}

/**
 * A minimal address check.
 *
 * Not a validator - nobody should write one of those. It only catches the
 * mistakes that would make Resend reject the whole batch: an empty value, a
 * missing @, or whitespace where an address should be.
 */
export function isPlausibleAddress(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  return trimmed.length > 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
  config?: EmailConfig | null;
}): Promise<EmailResult> {
  const config = options.config ?? readEmailConfig();

  if (!config) {
    return {
      sent: false,
      reason: "Email is not configured. Set RESEND_API_KEY and ALERT_EMAIL_FROM.",
      retryable: false
    };
  }

  if (!isPlausibleAddress(options.to)) {
    return { sent: false, reason: "No usable recipient address.", retryable: false };
  }

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: config.from,
        to: [options.to.trim()],
        subject: options.subject,
        text: options.text,
        html: options.html
      })
    });
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "Email request failed.",
      retryable: true
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      sent: false,
      // 429 and 5xx are worth another sweep. A 4xx is a configuration or address
      // problem and will fail identically forever, so it must not be retried.
      retryable: response.status === 429 || response.status >= 500,
      reason: `Resend responded ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.`
    };
  }

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;
  return { sent: true, id: payload?.id ?? null };
}
