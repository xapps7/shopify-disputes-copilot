/**
 * The email a merchant actually receives.
 *
 * One message per sweep, not one per alert. A merchant whose store takes five
 * chargebacks in an hour should get one email listing five, not five emails -
 * and the hourly sweep makes that the natural batch.
 *
 * Pure and alias-free so the copy and the escaping are directly testable.
 */

export type EmailAlert = {
  disputeId: string;
  kind: string;
  title: string;
  body: string;
  urgency: number;
};

export type BuiltEmail = {
  subject: string;
  text: string;
  html: string;
};

/**
 * HTML-escapes a value bound for an email body.
 *
 * Order names and amounts come from Shopify, and a merchant can name an order
 * anything. Interpolating that into HTML unescaped would put whatever they typed
 * into every recipient's inbox.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function subjectFor(alerts: EmailAlert[], shopDomain: string): string {
  const first = alerts[0];

  if (alerts.length === 1) {
    return first.title;
  }

  // Lead with the worst, and say how much else there is. "3 disputes need you"
  // hides which one matters; naming the worst does not.
  return `${first.title} (and ${alerts.length - 1} more on ${shopDomain})`;
}

/**
 * Builds the message.
 *
 * Deliberately plain: no images, no tracking pixel, no marketing furniture.
 * This is a transactional warning about money and a deadline, and it should read
 * like one. Plain text is generated first and the HTML mirrors it exactly, so a
 * client that strips HTML loses nothing.
 */
export function buildAlertEmail(options: {
  shopDomain: string;
  alerts: EmailAlert[];
  /** Absolute URL of the app's dispute list, when one can be built. */
  appUrl?: string | null;
}): BuiltEmail | null {
  const alerts = options.alerts;
  if (alerts.length === 0) {
    return null;
  }

  const link = options.appUrl?.replace(/\/+$/, "") ?? null;

  const textLines: string[] = [];
  const htmlParts: string[] = [];

  for (const item of alerts) {
    textLines.push(`${item.title}`, item.body, "");
    htmlParts.push(
      `<h2 style="margin:24px 0 4px;font-size:16px;font-weight:600;">${escapeHtml(item.title)}</h2>` +
        `<p style="margin:0;color:#444;">${escapeHtml(item.body)}</p>`
    );
  }

  if (link) {
    textLines.push(`Open Disputes Co-Pilot: ${link}`, "");
    htmlParts.push(
      `<p style="margin:28px 0 0;"><a href="${escapeHtml(link)}" ` +
        `style="color:#005bd3;">Open Disputes Co-Pilot</a></p>`
    );
  }

  const footer =
    "You are receiving this because Disputes Co-Pilot is installed on " +
    `${options.shopDomain}. Turn these off in the app's Settings.`;

  textLines.push("--", footer);
  htmlParts.push(
    `<hr style="margin:28px 0 12px;border:none;border-top:1px solid #e1e1e1;" />` +
      `<p style="margin:0;color:#6d7175;font-size:12px;">${escapeHtml(footer)}</p>`
  );

  return {
    subject: subjectFor(alerts, options.shopDomain),
    text: textLines.join("\n").trim(),
    html:
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
      `max-width:520px;margin:0 auto;padding:8px 16px;line-height:1.5;">` +
      htmlParts.join("") +
      `</div>`
  };
}
