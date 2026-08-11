"use client";

/**
 * Every client -> API call must carry an App Bridge session token. Without it
 * the server has no verified identity for the request and will answer 401.
 */

type ShopifyGlobal = {
  idToken?: () => Promise<string>;
};

async function getSessionToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  const shopify = (window as unknown as { shopify?: ShopifyGlobal }).shopify;
  if (!shopify?.idToken) {
    return null;
  }

  try {
    return await shopify.idToken();
  } catch {
    return null;
  }
}

export async function authenticatedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await getSessionToken();
  const headers = new Headers(init.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}
