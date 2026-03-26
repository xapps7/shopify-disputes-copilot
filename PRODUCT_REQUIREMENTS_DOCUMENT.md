# Product Requirements Document

## Shopify Disputes and Chargeback Ops Co-Pilot

Version: 1.0  
Date: March 25, 2026  
Product Stage: V1 Definition  
Target Merchants: Shopify and Shopify Plus merchants using Shopify Payments

---

## 1. Purpose

This PRD defines the product, technical, operational, compliance, and delivery requirements for a Shopify app that helps merchants manage Shopify Payments disputes more effectively.

The product is intended to:

- reduce the time spent preparing dispute responses
- improve evidence completeness and organization
- give merchants a clear operational workflow for dispute handling
- provide prevention recommendations based on dispute outcomes and order patterns

This document is written for founders, product, engineering, design, QA, compliance, and implementation partners.

---

## 2. Product Summary

Shopify merchants frequently struggle with chargebacks and disputes because evidence is fragmented across orders, refunds, fulfillment records, support conversations, and internal notes. The process is operationally painful, time-sensitive, and difficult to standardize.

The proposed app is a Shopify Payments dispute operations co-pilot that:

- ingests disputes and dispute updates via webhooks
- syncs dispute and order context from Shopify Admin APIs
- assembles evidence from Shopify-native and merchant-supplied sources
- generates a bank-ready evidence packet
- guides the merchant through review and submission
- tracks outcomes and recommends prevention improvements

The app does not guarantee outcomes. Banks and card networks still decide the result.

---

## 3. Problem Statement

Merchants face four recurring problems:

1. Dispute handling is fragmented.
2. Evidence is often incomplete or poorly structured.
3. Submission deadlines are easy to miss.
4. Merchants do not know what changes will reduce future disputes.

Current merchant pain includes:

- disputes arriving without a repeatable internal process
- confusion about what evidence is most persuasive
- difficulty collecting tracking, refund, policy, and communication records quickly
- frustration when good evidence still does not guarantee a favorable ruling

---

## 4. Product Vision

Create the default operating system for Shopify Payments disputes: a merchant-facing workspace that turns a stressful, manual, time-sensitive process into a structured and repeatable workflow.

---

## 5. V1 Positioning

### Core Value Proposition

"Respond to Shopify Payments disputes faster with better evidence and less manual work."

### What V1 Promises

- faster dispute preparation
- better evidence organization
- clearer action steps
- improved operational discipline

### What V1 Does Not Promise

- guaranteed chargeback wins
- issuer or bank outcome control
- complete automation for every processor
- complete evidence collection from every external system

---

## 6. Scope

### In Scope for V1

- Shopify Payments disputes only
- Shopify App Store-compatible public app direction
- embedded app experience inside Shopify Admin
- dispute webhook ingestion
- dispute and order sync from Shopify Admin API
- evidence vault for Shopify-native and merchant-uploaded evidence
- dispute timeline view
- evidence checklist and completeness scoring
- packet generation in PDF format
- guided submission workflow
- manual submission fallback
- dispute analytics dashboard
- prevention recommendation engine
- non-sponsored partner recommendations section

### Out of Scope for V1

- non-Shopify Payments dispute API automation
- deep integrations with all helpdesk and email tools
- automatic recovery pricing model
- guaranteed success-rate claims
- legal advisory workflows
- full multi-processor representment platform

### Future Scope

- multi-processor evidence organizer
- support platform connectors
- shipping carrier connectors
- team review and approval workflow
- partner-sponsored placements
- advanced automation rules

---

## 7. Feasibility Assessment

### Overall Feasibility

V1 is feasible if the product is kept Shopify Payments-first and if evidence submission is treated as a capability to validate during implementation rather than a launch assumption.

### Why It Is Feasible

Shopify currently exposes the main primitives needed for a dispute operations product:

- `disputes/create` and `disputes/update` webhook topics
- dispute data in Admin GraphQL
- Shopify Payments dispute evidence resources
- order, fulfillment, refund, and transaction context
- app embed architecture in Shopify Admin
- compliance mechanisms for customer data and privacy requests

### Main Feasibility Constraints

- dispute APIs are centered on Shopify Payments
- strong evidence often lives outside Shopify
- app handles protected customer data
- evidence submission and file workflows must be validated early

### Product Decision

V1 will be launched as a Shopify Payments dispute operations product, not as a universal chargeback automation platform.

---

## 8. Goals and Success Metrics

### Primary Goals

- reduce time to prepare a dispute response by at least 50 percent
- increase percentage of disputes with complete evidence before deadline
- centralize dispute operations into one merchant workflow

### Secondary Goals

- identify preventable root causes
- create a foundation for partner referrals
- build merchant trust in a high-friction process

### KPIs

- average time from dispute creation to evidence-ready state
- percentage of disputes submitted before due date
- evidence completeness rate
- disputes managed per merchant per month
- merchant weekly active usage
- packet generation rate
- outcome tracking coverage

---

## 9. User Personas

### Persona 1: Founder-Operator

Runs a growing Shopify store, handles disputes personally, wants speed and clarity, has limited time.

### Persona 2: Operations Manager

Manages support and fulfillment coordination, needs a reliable process and due-date visibility.

### Persona 3: Finance or Risk Lead

Needs reporting on disputed revenue, outcomes, and preventable causes.

### Persona 4: Shopify Plus Team

Needs workflow consistency, team visibility, and evidence quality across larger order volume.

---

## 10. User Jobs to Be Done

- Tell me when a dispute appears.
- Show me the full context for the order and payment.
- Tell me which evidence matters most.
- Help me gather missing evidence quickly.
- Give me a packet I can trust.
- Make sure I do not miss deadlines.
- Show me what to change to reduce future disputes.

---

## 11. Product Principles

- narrow scope beats broad but unreliable automation
- evidence quality matters more than flashy AI claims
- merchant trust requires clear expectations
- privacy and minimization are product requirements, not backend afterthoughts
- manual fallback is better than broken automation

---

## 12. Assumptions

- the initial merchant base primarily uses Shopify Payments
- merchants will accept a guided workflow if it clearly reduces work
- merchants will upload or connect missing evidence if prompted well
- Shopify App Store review is more likely to succeed with limited, justified scopes
- evidence submission through APIs must be validated in development before product promises are made

---

## 13. End-to-End User Flow

### Flow 1: New Dispute Intake

1. Shopify sends `disputes/create`.
2. App verifies webhook authenticity.
3. App stores and syncs dispute details.
4. App fetches order and payment context.
5. Merchant sees a new dispute in dashboard with urgency and next actions.

### Flow 2: Evidence Assembly

1. App classifies dispute reason.
2. App gathers Shopify-native records.
3. App creates an evidence checklist.
4. Merchant uploads or confirms missing documents.
5. App marks evidence readiness state.

### Flow 3: Packet Review

1. Merchant opens dispute workspace.
2. App shows timeline, checklist, and evidence categories.
3. App generates a structured summary and PDF packet.
4. Merchant reviews and approves edits.

### Flow 4: Submission

1. Merchant chooses submit path.
2. If validated API submission is enabled, app submits evidence.
3. Otherwise merchant uses manual-submit instructions with packet download.
4. App logs the final action.

### Flow 5: Outcome and Prevention

1. Shopify sends `disputes/update`.
2. App records win, loss, acceptance, or closure state.
3. App tags likely root cause.
4. Merchant receives prevention recommendations.

---

## 14. Functional Requirements

### 14.1 Merchant Installation and Auth

The app must:

- support Shopify OAuth installation
- store tokens securely
- support embedded app usage
- detect uninstall and clean up state appropriately

### 14.2 Webhook Ingestion

The app must:

- subscribe to `disputes/create`
- subscribe to `disputes/update`
- verify HMAC signatures
- process events idempotently
- persist webhook processing logs

The app should also implement:

- `app/uninstalled`
- `shop/update`
- required privacy webhooks
- `orders/risk_assessment_changed` if used in prevention features

### 14.3 Dispute Sync

The app must fetch and store:

- dispute identifiers
- status
- reason and reason details
- amount and currency
- evidence due date
- associated order reference
- dispute evidence status where available

### 14.4 Order Context Sync

The app must fetch and store required dispute-related order context:

- order number
- order date
- line items
- customer contact data required for operations
- fulfillment events
- tracking numbers
- refunds and adjustments
- transaction references

### 14.5 Dispute Timeline

Each dispute record must support a timeline containing:

- dispute created
- dispute updated
- evidence item added
- packet generated
- submission action
- outcome recorded

### 14.6 Evidence Vault

The app must support:

- evidence item creation
- evidence category assignment
- merchant file uploads
- evidence descriptions
- evidence metadata storage
- auditability of changes

### 14.7 Evidence Checklist

The app must generate a reason-based checklist of:

- required evidence
- recommended evidence
- missing evidence
- evidence already attached

### 14.8 Packet Generation

The app must generate:

- a structured PDF packet
- a merchant reviewable summary
- categorized evidence sections
- exportable file list

### 14.9 Submission Workflow

The app must support:

- clear submit status
- API submission path if validated
- manual submission fallback
- submission timestamp recording

### 14.10 Analytics

The app must display:

- open disputes
- due soon disputes
- total disputed amount
- won and lost counts
- dispute reasons
- evidence readiness states

### 14.11 Prevention Recommendations

The app must provide rules-based recommendations tied to:

- dispute reason trends
- delivery issues
- refund timing
- order risk signals
- policy visibility gaps

### 14.12 Partner Recommendations

The app may show:

- recommended tools by category
- transparent labeling of sponsorship if introduced later
- merchant-consented lead capture

---

## 15. Evidence Categories for V1

- delivery confirmation
- shipping documentation
- refund proof
- customer communication
- service documentation
- product description or listing proof
- policy disclosure or policy acceptance proof
- account access or usage records where applicable
- additional supporting documents

---

## 16. UX Requirements

### Main Screens

- onboarding
- disputes dashboard
- dispute detail workspace
- evidence library
- packet preview
- analytics dashboard
- recommendations page
- settings
- partner recommendations page

### UX Requirements

- due dates must be visually obvious
- dispute status must be unambiguous
- evidence gaps must be easy to identify
- packet preview must be editable before finalization
- the app must clearly state that banks determine the final outcome
- the app must present a manual fallback when automation is unavailable

---

## 17. Technical Requirements

### Recommended Architecture

- frontend: Shopify embedded app using Remix or Next.js
- UI framework: Polaris
- backend: Node.js with TypeScript
- database: PostgreSQL
- background jobs: queue-based worker system
- caching: Redis or equivalent
- file storage: S3-compatible object storage
- PDF generation: server-side renderer

### Architectural Requirements

- webhook receiver must be lightweight
- all heavy work must run asynchronously
- data writes must be idempotent
- file handling must be secure and access-controlled
- observability must cover webhook failures and job failures

---

## 18. Shopify Platform Requirements

### APIs

Primary data layer:

- GraphQL Admin API

Platform primitives required:

- disputes query and dispute objects
- Shopify Payments dispute evidence resources
- order, fulfillment, refund, and transaction context
- webhook subscriptions

### Required Capability Validation

The implementation team must validate early:

- the exact access scopes needed
- evidence file upload path
- supported file types and size limits
- whether submission works consistently for supported dispute states

Until that validation is complete, the product must not market one-click evidence submission as guaranteed functionality.

---

## 19. Security and Compliance Requirements

### Protected Customer Data

The app should assume it processes protected customer data and design accordingly.

Requirements:

- collect the minimum customer data necessary
- encrypt sensitive data at rest
- protect file access with signed URLs or equivalent
- maintain internal access controls
- log administrative access to sensitive workflows

### Mandatory Privacy Compliance

The app must implement and test:

- customer data request webhook handling
- customer redact webhook handling
- shop redact webhook handling

### Retention and Deletion

The app must define and enforce:

- document retention windows
- merchant deletion workflow
- purge behavior after uninstall or account termination where required

---

## 20. Non-Functional Requirements

### Performance

- webhook acknowledgments under 5 seconds
- dispute sync jobs should begin near-real-time
- typical dashboard loads should be under 2 seconds
- packet generation should complete within 30 seconds for standard cases

### Reliability

- webhook ingestion must be retry-safe
- queue jobs must support retries and dead-letter handling
- file processing failures must be recoverable

### Scalability

- support early multi-merchant growth without architectural redesign
- support object storage for evidence artifacts

### Observability

- structured logs
- background job monitoring
- API error tracking
- business event instrumentation

---

## 21. Risks and Mitigations

### Risk 1: Shopify Payments Limitation

Risk:

The app does not cover non-Shopify Payments disputes natively.

Mitigation:

Launch with explicit Shopify Payments-first positioning and add a manual evidence organizer later for other processors.

### Risk 2: Missing External Evidence

Risk:

Key evidence may exist outside Shopify.

Mitigation:

Support merchant uploads in v1 and design connectors as a later expansion path.

### Risk 3: Compliance Complexity

Risk:

Sensitive customer and dispute data increases security and review burden.

Mitigation:

Adopt data minimization, encryption, retention controls, and mandatory privacy webhooks from the start.

### Risk 4: Submission Automation Gaps

Risk:

Evidence submission or file workflows may have constraints that affect the intended experience.

Mitigation:

Prototype and validate this path in the first implementation phase and keep a manual fallback in the product.

### Risk 5: Merchant Expectations

Risk:

Merchants may assume the app guarantees wins.

Mitigation:

Use careful positioning in onboarding, UI copy, pricing, and marketing.

---

## 22. Roadmap

### Phase 0: Discovery and Validation

Duration:

- 2 weeks

Objectives:

- validate disputes webhooks and dispute sync
- verify API scopes and app review implications
- validate evidence update, file handling, and submission path
- finalize v1 capability boundaries

Outputs:

- technical spike results
- updated scope decision
- app review risk log

### Phase 1: Core Platform Build

Duration:

- 3 weeks

Objectives:

- install flow
- auth
- webhook receiver
- dispute and order sync
- persistence layer

Outputs:

- functioning backend foundation
- raw dispute intake in product

### Phase 2: Merchant Workflow Build

Duration:

- 4 weeks

Objectives:

- disputes dashboard
- dispute workspace
- evidence vault
- evidence checklist
- packet generation

Outputs:

- merchant-ready core workflow

### Phase 3: Submission and Analytics

Duration:

- 3 weeks

Objectives:

- submission flow or manual fallback flow
- dispute analytics
- due-date alerts
- prevention recommendations

Outputs:

- end-to-end dispute operations experience

### Phase 4: Compliance and Hardening

Duration:

- 2 weeks

Objectives:

- privacy webhooks
- retention and deletion controls
- security review
- instrumentation hardening
- app review preparation

Outputs:

- submission-ready release candidate

### Phase 5: Beta Launch

Duration:

- 2 to 4 weeks

Objectives:

- onboard pilot merchants
- monitor usage and issue patterns
- collect feedback
- prioritize post-beta roadmap

Outputs:

- validated beta learnings
- roadmap adjustments for general launch

---

## 23. Milestones

### Milestone 1

- app installs
- webhooks register
- disputes sync into dashboard

### Milestone 2

- order and fulfillment context displayed
- evidence checklist generated

### Milestone 3

- merchant uploads files
- packet PDF generated

### Milestone 4

- submission path validated or manual fallback released
- analytics dashboard live

### Milestone 5

- compliance readiness complete
- beta merchants onboarded

---

## 24. Launch Requirements

The product is not ready for public launch until all of the following are true:

- dispute webhooks are stable in production
- dispute sync is reliable and idempotent
- merchant evidence upload works consistently
- packet generation is stable
- privacy webhooks are implemented and tested
- retention and deletion policy is documented
- error monitoring is active
- app review documentation is complete
- product copy does not overstate outcome guarantees

---

## 25. Pricing Direction

### Suggested Packaging

Starter:

- dispute dashboard
- evidence checklist
- manual packet builder

Growth:

- automated evidence assembly
- alerts
- analytics
- richer team workflows over time

Performance-based pricing should only be explored after outcome attribution is measurable and contract terms are defensible.

---

## 26. Open Questions

- What exact access scopes are required for all dispute evidence write operations?
- Which dispute states support the cleanest submission automation flow?
- What file-size and file-type constraints materially affect merchants?
- Should one helpdesk integration be included in beta, or deferred entirely?
- How much customer data can be avoided while still delivering operational value?

---

## 27. Final Recommendation

Proceed with a Shopify Payments-first v1. Build the product around dispute intake, evidence assembly, packet generation, and merchant workflow reliability. Treat evidence submission automation as a capability to prove, not assume. Maintain explicit merchant messaging that the app improves process quality and speed, while final outcomes remain with issuers and banks.

This is the most credible and execution-safe version of the product.
