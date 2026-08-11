/**
 * Shapes of the mandatory compliance webhook payloads.
 * https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */

export type ComplianceCustomer = {
  id?: number | string;
  email?: string | null;
  phone?: string | null;
};

export type CustomersDataRequestPayload = {
  shop_id?: number | string;
  shop_domain?: string;
  orders_requested?: Array<number | string>;
  customer?: ComplianceCustomer;
  data_request?: { id?: number | string };
};

export type CustomersRedactPayload = {
  shop_id?: number | string;
  shop_domain?: string;
  customer?: ComplianceCustomer;
  orders_to_redact?: Array<number | string>;
};

export type ShopRedactPayload = {
  shop_id?: number | string;
  shop_domain?: string;
};

export function parseJsonPayload<T>(body: string): T {
  if (!body.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    return {} as T;
  }
}
