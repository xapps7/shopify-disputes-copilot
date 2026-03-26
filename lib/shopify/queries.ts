export const DISPUTE_SYNC_QUERY = `#graphql
  query DisputeSync($id: ID!) {
    dispute(id: $id) {
      id
      amount
      currencyCode
      reason
      reasonDetails
      status
      evidenceDueBy
      evidenceSentOn
      initiatedAs
      initiatedAt
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
        amount
        currencyCode
        reason
        reasonDetails
        status
        evidenceDueBy
        evidenceSentOn
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
