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
  query DisputesList {
    disputes(first: 25) {
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
            nodes {
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

export const SHOPIFY_PAYMENTS_ACCOUNT_DISPUTES_QUERY = `#graphql
  query ShopifyPaymentsAccountDisputes {
    shopifyPaymentsAccount {
      disputes(first: 25) {
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
              nodes {
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
  }
`;
