export function buildEmbeddedAdminUrl(
  apiKey: string,
  shopDomain: string,
  _pathname = "/",
  host?: string | null,
  _redirectTo?: string | null
) {
  const query = new URLSearchParams({
    shop: shopDomain
  });

  if (host) {
    query.set("host", host);
  }

  return `https://${shopDomain}/admin/apps/${apiKey}?${query.toString()}`;
}
