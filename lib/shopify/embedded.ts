function decodeEmbeddedHost(host: string | null | undefined) {
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
  pathname = "/",
  host?: string | null,
  _redirectTo?: string | null
) {
  const appHandle = process.env.SHOPIFY_APP_HANDLE?.trim() || "disputes-co-pilot";
  const query = new URLSearchParams({
    shop: shopDomain
  });

  if (host) {
    query.set("host", host);
  }

  const decodedHost = decodeEmbeddedHost(host);
  const adminBase =
    decodedHost && decodedHost.startsWith("admin.shopify.com/")
      ? `https://${decodedHost}/apps/${appHandle}`
      : `https://${shopDomain}/admin/apps/${appHandle}`;

  const normalizedPath =
    pathname && pathname !== "/"
      ? `/${pathname.replace(/^\/+/, "")}`
      : "";

  return `${adminBase}${normalizedPath}?${query.toString()}`;
}
