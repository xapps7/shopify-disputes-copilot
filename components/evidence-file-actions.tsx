"use client";

import { useState } from "react";
import { Button, InlineStack, Text } from "@shopify/polaris";

import { copyToClipboard } from "@/components/copy-to-clipboard";

/**
 * Getting a prepared file OUT of this app and INTO Shopify's uploader.
 *
 * Shopify's evidence slots are file pickers. There is no URL field, so a link
 * to a file stored here is useless at the moment of upload - the merchant needs
 * the bytes on their own disk to select. That makes "Download" the primary
 * action on every attachment, not an afterthought.
 *
 * The link is still worth copying, for one job: opening the file on the machine
 * they are actually uploading from, when that is not this one. It is NOT for
 * quoting in the response text - Shopify's evidence rules exclude links to
 * pages held elsewhere, and an earlier version of this comment said otherwise.
 *
 * `download` on the anchor asks the browser to save rather than navigate.
 * Cross-origin it is only a hint - S3 without a Content-Disposition header will
 * open the file in a tab instead - which is survivable, because the merchant can
 * still save from there, and better than not offering it.
 */

type EvidenceFileActionsProps = {
  fileUrl: string;
  /** Used as the saved filename, so it arrives named like the thing it is. */
  title: string;
};

/** Keeps a file called "Delivery confirmation" from saving as "Delivery confirmation". */
function withExtension(title: string, fileUrl: string): string {
  const fromUrl = fileUrl.split("?")[0].split("#")[0].split(".").pop() ?? "";
  const extension = /^[a-zA-Z0-9]{2,5}$/.test(fromUrl) ? `.${fromUrl.toLowerCase()}` : "";

  const safe = title.replace(/[^\w\- ]+/g, "").trim() || "evidence";
  return safe.toLowerCase().endsWith(extension) ? safe : `${safe}${extension}`;
}

export function EvidenceFileActions({ fileUrl, title }: EvidenceFileActionsProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(fileUrl);
    setCopied(ok);
    setCopyFailed(!ok);

    if (ok) {
      window.setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <InlineStack align="start" blockAlign="center" gap="200" wrap>
      {/*
        Primary, because Shopify's slot takes a file and nothing else. A merchant
        who only ever clicks one button here should click this one.
      */}
      <Button
        download={withExtension(title, fileUrl)}
        external
        url={fileUrl}
        variant="secondary"
      >
        Download
      </Button>

      <Button onClick={handleCopy} variant="tertiary">
        {copied ? "Link copied" : "Copy link"}
      </Button>

      {copyFailed ? (
        <Text as="span" variant="bodySm" tone="subdued">
          {/*
            Embedded apps run in an iframe where the clipboard API is often
            refused outright. Saying so beats a button that silently does
            nothing.
          */}
          Copy was blocked in this frame. Open the file and copy the address bar.
        </Text>
      ) : null}
    </InlineStack>
  );
}
