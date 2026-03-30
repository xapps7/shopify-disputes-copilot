export function buildEmbeddedAdminUrl(
  apiKey: string,
  shopDomain: string,
  pathname = "/",
  host?: string | null,
  redirectTo?: string | null
) {
  const query = new URLSearchParams({
    shop: shopDomain
  });

  if (host) {
    query.set("host", host);
  }

  const normalizedPath = pathname === "/" ? "" : pathname;
  const nextPath = redirectTo ?? (normalizedPath ? pathname : null);

  if (nextPath) {
    query.set("redirectTo", nextPath);
  }

  return `https://${shopDomain}/admin/apps/${apiKey}${normalizedPath}?${query.toString()}`;
}
