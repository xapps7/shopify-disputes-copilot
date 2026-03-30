export function decodeEmbeddedHost(host: string | null | undefined) {
  if (!host) {
    return null;
  }

  try {
    return Buffer.from(host, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function buildEmbeddedAdminUrl(
  apiKey: string,
  shopDomain: string,
  pathname = "/dashboard",
  host?: string | null
) {
  const query = new URLSearchParams({
    shop: shopDomain,
    redirectTo: pathname
  });

  if (host) {
    query.set("host", host);
  }

  const decodedHost = decodeEmbeddedHost(host);
  const basePath =
    decodedHost && decodedHost.startsWith("admin.shopify.com/")
      ? `https://${decodedHost}/apps/${apiKey}`
      : `https://${shopDomain}/admin/apps/${apiKey}`;

  return `${basePath}?${query.toString()}`;
}
