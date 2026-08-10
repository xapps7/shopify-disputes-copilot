export const DISPUTE_SYNC_QUERY = `#graphql
  query DisputeSync($id: ID!) {
    dispute(id: $id) {
      id
      amount {
        amount
        currencyCode
      }
      reasonDetails {
        reason
        networkReasonCode
      }
      status
      evidenceDueBy
      evidenceSentOn
      initiatedAt
      type
      order {
        id
        name
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customer {
          id
          firstName
          lastName
          email
        }
        displayFinancialStatus
        displayFulfillmentStatus
      }
    }
  }
`;

export const DISPUTES_LIST_QUERY = `#graphql
  query DisputesList($after: String) {
    disputes(first: 100, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        amount {
          amount
          currencyCode
        }
        reasonDetails {
          reason
          networkReasonCode
        }
        status
        evidenceDueBy
        evidenceSentOn
        type
        order {
          id
          name
          displayFulfillmentStatus
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            firstName
            lastName
            email
          }
          lineItems(first: 10) {
            nodes {
              name
              quantity
              sku
            }
          }
          fulfillments(first: 10) {
            trackingInfo {
              company
              number
              url
            }
          }
        }
      }
    }
  }
`;

export const SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY = `#graphql
  query ShopifyPaymentsAccountDisputes($after: String) {
    shopifyPaymentsAccount {
      disputes(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          amount {
            amount
            currencyCode
          }
          reasonDetails {
            reason
            networkReasonCode
          }
          status
          evidenceDueBy
          evidenceSentOn
          type
          order {
            id
            name
            displayFulfillmentStatus
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              firstName
              lastName
              email
            }
            lineItems(first: 10) {
              nodes {
                name
                quantity
                sku
              }
            }
            fulfillments(first: 10) {
              trackingInfo {
                company
                number
                url
              }
            }
          }
        }
      }
    }
  }
`;

export const ORDERS_WITH_DISPUTES_QUERY = `#graphql
  query OrdersWithDisputes($after: String) {
    orders(first: 100, after: $after, reverse: true, sortKey: CREATED_AT, query: "status:any") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        displayFulfillmentStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customer {
          firstName
          lastName
          email
        }
        lineItems(first: 10) {
          nodes {
            name
            quantity
            sku
          }
        }
        fulfillments(first: 10) {
          trackingInfo {
            company
            number
            url
          }
        }
        disputes {
          id
          status
          initiatedAs
        }
      }
    }
  }
`;

export const BASIC_ORDERS_DEBUG_QUERY = `#graphql
  query BasicOrdersDebug {
    orders(first: 100, reverse: true, sortKey: CREATED_AT, query: "status:any") {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
      }
    }
  }
`;

export const RECENT_ORDERS_WITH_DETAILS_QUERY = `#graphql
  query RecentOrdersWithDetails {
    orders(first: 100, reverse: true, sortKey: CREATED_AT, query: "status:any") {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customer {
          firstName
          lastName
          email
        }
        lineItems(first: 10) {
          nodes {
            name
            quantity
            sku
          }
        }
        fulfillments(first: 10) {
          trackingInfo {
            company
            number
            url
          }
        }
        disputes {
          id
          status
          initiatedAs
        }
      }
    }
  }
`;

export const ACCESS_SCOPES_DEBUG_QUERY = `#graphql
  query AccessScopesDebug {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
    shop {
      id
      myshopifyDomain
    }
  }
`;

export const ORDER_BY_ID_DEBUG_QUERY = `#graphql
  query OrderByIdDebug($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      currentTotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      customer {
        firstName
        lastName
        email
      }
      lineItems(first: 10) {
        nodes {
          name
          quantity
          sku
        }
      }
      fulfillments(first: 10) {
        trackingInfo {
          company
          number
          url
        }
      }
      disputes {
        id
        status
        initiatedAs
      }
    }
  }
`;

export const ORDER_DETAILS_BY_ID_QUERY = `#graphql
  query OrderDetailsById($id: ID!) {
    order(id: $id) {
      id
      name
      displayFulfillmentStatus
      currentTotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      customer {
        firstName
        lastName
        email
      }
      lineItems(first: 10) {
        nodes {
          name
          quantity
          sku
        }
      }
      fulfillments(first: 10) {
        trackingInfo {
          company
          number
          url
        }
      }
      disputes {
        id
        status
        initiatedAs
      }
    }
  }
`;

export const ORDERS_BY_SEARCH_DEBUG_QUERY = `#graphql
  query OrdersBySearchDebug($query: String!) {
    orders(first: 10, reverse: true, sortKey: CREATED_AT, query: $query) {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        disputes {
          id
          status
          initiatedAs
        }
      }
    }
  }
`;

/* ------------------------------------------------------------------ *
 * Scope-isolating diagnostic probes.
 *
 * Shopify raises ACCESS_DENIED at query-analysis time, which nulls the
 * ENTIRE `data` payload — not just the offending field. So a single
 * missing scope (e.g. `read_customers` on `order { customer { ... } }`)
 * makes an otherwise-valid query look like "0 results".
 *
 * Each probe below requests the minimum possible field set so we can tell
 * exactly which field is poisoning the real queries.
 * ------------------------------------------------------------------ */

export const PROBE_ORDERS_DISPUTES_ONLY_QUERY = `#graphql
  query ProbeOrdersDisputesOnly {
    orders(first: 20, reverse: true, sortKey: CREATED_AT, query: "status:any") {
      nodes {
        id
        name
        createdAt
        disputes {
          id
          status
          initiatedAs
        }
      }
    }
  }
`;

export const PROBE_ORDERS_CUSTOMER_ONLY_QUERY = `#graphql
  query ProbeOrdersCustomerOnly {
    orders(first: 5, reverse: true, sortKey: CREATED_AT, query: "status:any") {
      nodes {
        id
        name
        customer {
          id
        }
      }
    }
  }
`;

export const PROBE_ORDERS_CUSTOMER_PII_QUERY = `#graphql
  query ProbeOrdersCustomerPii {
    orders(first: 5, reverse: true, sortKey: CREATED_AT, query: "status:any") {
      nodes {
        id
        name
        customer {
          firstName
          lastName
          email
        }
      }
    }
  }
`;

export const PROBE_ORDERS_MONEY_ONLY_QUERY = `#graphql
  query ProbeOrdersMoneyOnly {
    orders(first: 5, reverse: true, sortKey: CREATED_AT, query: "status:any") {
      nodes {
        id
        name
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
    }
  }
`;

export const PROBE_ROOT_DISPUTES_MINIMAL_QUERY = `#graphql
  query ProbeRootDisputesMinimal {
    disputes(first: 25) {
      nodes {
        id
        status
        type
        initiatedAt
        evidenceDueBy
        amount {
          amount
          currencyCode
        }
      }
    }
  }
`;

export const PROBE_SHOPIFY_PAYMENTS_ACCOUNT_QUERY = `#graphql
  query ProbeShopifyPaymentsAccount {
    shopifyPaymentsAccount {
      id
    }
  }
`;

export const PROBE_ORDER_BY_ID_MINIMAL_QUERY = `#graphql
  query ProbeOrderByIdMinimal($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      disputes {
        id
        status
        initiatedAs
      }
    }
  }
`;

/**
 * Full dispute detail WITHOUT any customer traversal, so it survives a
 * missing `read_customers` scope / unapproved protected customer data.
 */
export const DISPUTES_LIST_NO_CUSTOMER_QUERY = `#graphql
  query DisputesListNoCustomer($after: String) {
    disputes(first: 100, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        status
        type
        initiatedAt
        evidenceDueBy
        evidenceSentOn
        amount {
          amount
          currencyCode
        }
        reasonDetails {
          reason
          networkReasonCode
        }
        order {
          id
          name
          displayFulfillmentStatus
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItems(first: 10) {
            nodes {
              name
              quantity
              sku
            }
          }
          fulfillments(first: 10) {
            trackingInfo {
              company
              number
              url
            }
          }
        }
      }
    }
  }
`;

export const DISPUTE_SYNC_NO_CUSTOMER_QUERY = `#graphql
  query DisputeSyncNoCustomer($id: ID!) {
    dispute(id: $id) {
      id
      status
      type
      initiatedAt
      evidenceDueBy
      evidenceSentOn
      amount {
        amount
        currencyCode
      }
      reasonDetails {
        reason
        networkReasonCode
      }
      order {
        id
        name
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
    }
  }
`;

/** Customer PII fetched separately so denial degrades gracefully. */
export const ORDER_CUSTOMER_QUERY = `#graphql
  query OrderCustomer($id: ID!) {
    order(id: $id) {
      id
      customer {
        firstName
        lastName
        email
      }
    }
  }
`;

/**
 * Recent orders with everything the packet builder needs EXCEPT customer PII.
 * Customer data is fetched separately (see ORDER_CUSTOMER_QUERY) so that a
 * missing `read_customers` scope degrades one field instead of nulling
 * the whole payload.
 */
export const RECENT_ORDERS_NO_CUSTOMER_QUERY = `#graphql
  query RecentOrdersNoCustomer {
    orders(first: 100, reverse: true, sortKey: CREATED_AT, query: "status:any") {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 10) {
          nodes {
            name
            quantity
            sku
          }
        }
        fulfillments(first: 10) {
          trackingInfo {
            company
            number
            url
          }
        }
        disputes {
          id
          status
          initiatedAs
        }
      }
    }
  }
`;

export const ORDER_DETAILS_NO_CUSTOMER_BY_ID_QUERY = `#graphql
  query OrderDetailsNoCustomerById($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      currentTotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      lineItems(first: 10) {
        nodes {
          name
          quantity
          sku
        }
      }
      fulfillments(first: 10) {
        trackingInfo {
          company
          number
          url
        }
      }
      disputes {
        id
        status
        initiatedAs
      }
    }
  }
`;
