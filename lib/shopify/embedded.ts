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

  return `https://${shopDomain}/admin/apps/${apiKey}?${query.toString()}`;
}
