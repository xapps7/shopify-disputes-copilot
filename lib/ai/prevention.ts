import type { DisputeDetailView, PreventionRecommendationView } from "@/lib/types";

type OutcomeReviewInput = {
  outcome: string;
  rootCause: string;
  notes: string;
};

function recommendationPriority(rootCause: string) {
  if (rootCause === "FRAUD_SCREENING" || rootCause === "FULFILLMENT_GAP") {
    return 1;
  }

  if (rootCause === "POLICY_CLARITY" || rootCause === "CUSTOMER_SUPPORT_DELAY") {
    return 2;
  }

  return 3;
}

export function buildPreventionRecommendations(
  dispute: DisputeDetailView,
  review: OutcomeReviewInput
): PreventionRecommendationView[] {
  const recommendations: PreventionRecommendationView[] = [];

  if (review.rootCause === "FRAUD_SCREENING" || dispute.reason === "FRAUD") {
    recommendations.push({
      id: `generated-fraud-${dispute.id}`,
      category: "ORDER_RISK",
      recommendationText:
        "Apply higher scrutiny to similar high-risk orders and require stronger manual review before fulfillment.",
      priority: 1,
      state: "OPEN"
    });
    recommendations.push({
      id: `generated-3ds-${dispute.id}`,
      category: "CHECKOUT_AUTHENTICATION",
      recommendationText:
        "Review Shopify Payments fraud and authentication settings so more risky transactions are challenged before capture.",
      priority: 1,
      state: "OPEN"
    });
  }

  if (review.rootCause === "FULFILLMENT_GAP" || dispute.reason === "PRODUCT_NOT_RECEIVED") {
    recommendations.push({
      id: `generated-tracking-${dispute.id}`,
      category: "FULFILLMENT",
      recommendationText:
        "Improve delivery proof capture by standardizing tracking, carrier status snapshots, and post-delivery confirmation messaging.",
      priority: 1,
      state: "OPEN"
    });
  }

  if (review.rootCause === "POLICY_CLARITY") {
    recommendations.push({
      id: `generated-policy-${dispute.id}`,
      category: "POLICY_DISCLOSURE",
      recommendationText:
        "Clarify refund, delivery, and cancellation terms in checkout and post-purchase messaging so policy evidence is easier to defend.",
      priority: 2,
      state: "OPEN"
    });
  }

  if (review.rootCause === "CUSTOMER_SUPPORT_DELAY") {
    recommendations.push({
      id: `generated-support-${dispute.id}`,
      category: "SUPPORT_OPERATIONS",
      recommendationText:
        "Reduce support response time for at-risk orders and preserve customer communication so dispute replies are backed by a clear service timeline.",
      priority: 2,
      state: "OPEN"
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: `generated-default-${dispute.id}`,
      category: "PROCESS_DISCIPLINE",
      recommendationText:
        "Review the operational path for this order type and tighten documentation so the next dispute has stronger evidence earlier.",
      priority: recommendationPriority(review.rootCause),
      state: "OPEN"
    });
  }

  if (review.notes.trim().length > 0) {
    recommendations.push({
      id: `generated-notes-${dispute.id}`,
      category: "MERCHANT_LEARNING",
      recommendationText: `Operator note: ${review.notes.trim()}`,
      priority: 3,
      state: "OPEN"
    });
  }

  return recommendations;
}
