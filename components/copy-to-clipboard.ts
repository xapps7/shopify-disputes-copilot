"use client";

/**
 * Copy is the single most-used action in the response builder: the whole point
 * of the workspace is that the merchant pastes each field into Shopify's form.
 *
 * Embedded apps run inside an iframe, where `navigator.clipboard` is often
 * unavailable or rejected by permissions policy. Falling back to a hidden
 * textarea keeps the button honest there, and the boolean return lets callers
 * say "copy failed, select the text yourself" rather than silently doing
 * nothing.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof document === "undefined") {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Blocked in the iframe - fall through to the legacy path.
    }
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
