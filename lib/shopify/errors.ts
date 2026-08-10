/**
 * Normalizes errors returned by `@shopify/admin-api-client`.
 *
 * IMPORTANT: `ClientResponse.errors` is an OBJECT (`ResponseErrors`), not an array:
 *
 *   { networkStatusCode?: number; message?: string; graphQLErrors?: any[]; response?: Response }
 *
 * Earlier code in this repo used `Array.isArray(response.errors)` to decide whether
 * a request failed. That check is ALWAYS false, so every GraphQL error — including
 * `ACCESS_DENIED` scope failures — was silently discarded and treated as "success
 * with zero results". Always use `extractGraphqlErrors` instead.
 */

export type NormalizedGraphqlError = {
  message: string;
  code: string | null;
  path: string | null;
};

type ResponseErrorsLike = {
  networkStatusCode?: number;
  message?: string;
  graphQLErrors?: unknown[];
};

function normalizeSingle(raw: unknown): NormalizedGraphqlError | null {
  if (typeof raw === "string") {
    return { message: raw, code: null, path: null };
  }

  if (!raw || typeof raw !== "object") {
    return null;
  }

  const entry = raw as {
    message?: unknown;
    path?: unknown;
    extensions?: { code?: unknown } | null;
  };

  const message = typeof entry.message === "string" ? entry.message : null;
  if (!message) {
    return null;
  }

  const code =
    entry.extensions && typeof entry.extensions === "object" && typeof entry.extensions.code === "string"
      ? entry.extensions.code
      : null;

  const path = Array.isArray(entry.path) ? entry.path.join(".") : null;

  return { message, code, path };
}

export function extractGraphqlErrors(response: unknown): NormalizedGraphqlError[] {
  if (!response || typeof response !== "object") {
    return [];
  }

  const errors = (response as { errors?: unknown }).errors;
  if (!errors) {
    return [];
  }

  // Defensive: tolerate a future/alternate client that returns a plain array.
  if (Array.isArray(errors)) {
    return errors.map(normalizeSingle).filter((error): error is NormalizedGraphqlError => Boolean(error));
  }

  if (typeof errors !== "object") {
    return [];
  }

  const responseErrors = errors as ResponseErrorsLike;
  const graphQLErrors = Array.isArray(responseErrors.graphQLErrors) ? responseErrors.graphQLErrors : [];
  const normalized = graphQLErrors
    .map(normalizeSingle)
    .filter((error): error is NormalizedGraphqlError => Boolean(error));

  if (normalized.length > 0) {
    return normalized;
  }

  // Transport / network-level failure with no GraphQL error body.
  if (typeof responseErrors.message === "string" && responseErrors.message.length > 0) {
    return [
      {
        message: responseErrors.message,
        code:
          typeof responseErrors.networkStatusCode === "number"
            ? `HTTP_${responseErrors.networkStatusCode}`
            : "NETWORK",
        path: null
      }
    ];
  }

  return [];
}

export function graphqlErrorMessages(response: unknown): string[] {
  return extractGraphqlErrors(response).map((error) =>
    [error.path ? `[${error.path}]` : null, error.code ? `(${error.code})` : null, error.message]
      .filter(Boolean)
      .join(" ")
  );
}

export function hasGraphqlErrors(response: unknown): boolean {
  return extractGraphqlErrors(response).length > 0;
}

export function isAccessDeniedError(error: NormalizedGraphqlError): boolean {
  return error.code === "ACCESS_DENIED" || /access denied|not approved to access/i.test(error.message);
}

export function hasOnlyAccessDeniedErrors(response: unknown): boolean {
  const errors = extractGraphqlErrors(response);
  return errors.length > 0 && errors.every(isAccessDeniedError);
}
