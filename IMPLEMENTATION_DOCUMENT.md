# Disputes and Chargeback Ops Co-Pilot

## 1. Document Purpose

This document defines the complete implementation plan for a Shopify app focused on dispute operations for Shopify Payments merchants. It is written as a starter specification for product, engineering, compliance, and go-to-market alignment.

This v1 is intentionally narrow:

- Shopify Payments disputes only
- Shopify and Shopify Plus merchants
- Evidence preparation first
- Submission automation only where validated in implementation
- No guaranteed win-rate claims

The app's value proposition in v1 is:

- Reduce the time required to respond to disputes
- Improve evidence completeness and quality
- Centralize dispute operations into a usable merchant workflow
- Create structured prevention recommendations from dispute outcomes

## 2. Executive Summary

The product is feasible as a public Shopify app, but only with a disciplined scope. Shopify currently supports dispute webhooks, Shopify Payments dispute objects, and dispute evidence resources. That makes a dispute-management app viable for Shopify Payments merchants. The main constraints are that:

- Shopify's automation surface is largely Shopify Payments-specific
- dispute outcomes are still determined by banks and card networks
- evidence quality depends heavily on data outside Shopify
- privacy and protected customer data requirements are material

Recommended v1:

- Ingest `disputes/create` and `disputes/update`
- Pull dispute and order context from GraphQL Admin API
- Build a dispute timeline
- Assemble evidence from Shopify-native sources first
- Allow merchants to upload or attach missing documents
- Generate a bank-ready evidence packet and structured evidence checklist
- Support evidence drafting and optionally API submission after prototype validation

## 3. Product Scope

### 3.1 In Scope for V1

- Shopify Payments disputes only
- Public Shopify app
- Embedded app UI in Shopify Admin
- Webhook ingestion for dispute lifecycle updates
- GraphQL-based dispute and order data retrieval
- Evidence vault for Shopify-native evidence and merchant-supplied files
- Evidence packet generation
- Guided merchant workflow for:
  - review dispute
  - gather evidence
  - approve packet
  - submit evidence manually or via API where validated
- Operational analytics:
  - dispute counts
  - win/loss rates
  - evidence due dates
  - reason-code trends
- Prevention recommendations based on dispute reasons and order patterns
- Partner marketplace module with non-sponsored recommendations first

### 3.2 Out of Scope for V1

- Non-Shopify Payments processors as first-class API integrations
- Full omnichannel dispute orchestration
- Automatic ingestion of Gmail, Zendesk, Gorgias, Recharge, Klaviyo, or shipping-carrier APIs on day one
- AI-generated legal claims or guaranteed representment success
- Automated pricing based on recovered funds
- Region-specific legal advice

### 3.3 Phase 2 Scope

- Multi-processor evidence organizer
- Deeper integrations for support systems and shipping systems
- Benchmarking and outcome scoring
- Partner marketplace monetization
- Team workflows and approvals
- Regional data residency options

## 4. Merchant Problem

Merchants face three recurring issues:

- disputes are operationally fragmented across orders, payments, emails, refunds, and support history
- evidence is often incomplete, poorly structured, or submitted too late
- merchants do not know which types of evidence are strongest for each dispute reason

The app addresses those problems by turning dispute handling into a repeatable workflow.

## 5. Feasibility Assessment

### 5.1 Feasibility Rating

- Core dispute operations app: High feasibility
- Fully automated end-to-end representment platform: Medium feasibility
- Multi-processor unified automation in v1: Low feasibility

### 5.2 Why V1 Is Feasible

Shopify supports the essential primitives needed for a Shopify Payments dispute ops app:

- dispute webhook topics
- dispute objects in Admin APIs
- order and fulfillment retrieval
- dispute evidence resources
- app embed and admin UI extensions
- privacy and protected customer data compliance frameworks

### 5.3 Main Blockers

#### Blocker 1: Shopify Payments Scope Boundary

Dispute APIs are centered on Shopify Payments. Merchants using other processors will not get equivalent automation from Shopify-native APIs.

Mitigation:

- message v1 as Shopify Payments-first
- offer a manual evidence organizer for other processors later

#### Blocker 2: External Evidence Gaps

Important evidence often lives outside Shopify:

- support tickets
- email confirmations
- shipping provider scans
- signed proofs
- identity verification logs

Mitigation:

- start with Shopify-native evidence
- support merchant uploads
- add structured connectors later

#### Blocker 3: Compliance Burden

The app will process protected customer data and potentially sensitive dispute evidence.

Mitigation:

- minimize retained data
- encrypt at rest
- strict access controls
- retention policy
- mandatory compliance webhooks

#### Blocker 4: Submission Path Validation

Evidence update APIs exist, but the production workflow for file upload and final submission must be validated early. Submission should not be assumed until proven in a prototype against a development store with applicable access.

Mitigation:

- build a prototype track for evidence update and submission during Sprint 1
- keep a manual-submit fallback path in product design

## 6. Product Goals

### 6.1 Primary Goals

- Cut dispute response preparation time by at least 50%
- Increase on-time evidence submissions
- Improve evidence completeness
- Give merchants a clear operational dashboard

### 6.2 Secondary Goals

- Provide prevention guidance
- Generate qualified partner leads
- Build merchant trust with clear, compliant workflows

### 6.3 Non-Goals

- Promise chargeback wins
- Replace issuer or bank decision-making
- Store unnecessary historical customer data indefinitely

## 7. Primary Users

### 7.1 Merchant Personas

- Shopify SMB merchant with founder-led ops
- Shopify Plus merchant with support and finance teams
- operations manager handling disputes weekly
- risk or finance lead tracking loss rates and representment outcomes

### 7.2 User Jobs

- know when a dispute arrives
- see what happened on the order
- gather the right evidence quickly
- submit or prepare evidence before the deadline
- learn what to change to prevent future disputes

## 8. Core User Flows

### 8.1 Dispute Intake Flow

1. Shopify sends `disputes/create`
2. App validates webhook HMAC
3. App creates dispute record and timeline event
4. App fetches dispute details and related order context
5. Merchant sees a new dispute in dashboard with due date and status

### 8.2 Evidence Assembly Flow

1. System classifies dispute reason
2. System pulls Shopify-native evidence:
   - order details
   - fulfillment records
   - tracking numbers
   - refund history
   - transaction references
   - policy URLs captured from merchant config
3. System generates evidence checklist
4. Merchant uploads missing files and notes
5. App scores completeness

### 8.3 Packet Review Flow

1. Merchant opens dispute workspace
2. Evidence is organized by category
3. App generates narrative summary and structured evidence descriptions
4. Merchant edits or approves
5. App creates PDF packet and structured evidence object

### 8.4 Submission Flow

1. Merchant chooses `Submit via app` or `Manual submit`
2. If API submission is enabled and validated, app updates evidence and submits
3. If not, merchant downloads packet and follows guided submit instructions
4. Timeline records final action and timestamps

### 8.5 Outcome and Prevention Flow

1. `disputes/update` changes status
2. Outcome is recorded
3. App tags root cause
4. App produces prevention recommendations
5. Eligible partner tools may be shown with transparent disclosure

## 9. Functional Requirements

### 9.1 Authentication and Installation

- OAuth installation flow
- online and offline access tokens as needed
- secure token storage
- app embed within Shopify Admin

### 9.2 Webhooks

Required:

- `disputes/create`
- `disputes/update`
- privacy compliance webhooks required for public apps

Recommended:

- `app/uninstalled`
- `shop/update`
- `orders/risk_assessment_changed`
- `orders/updated`

### 9.3 Data Retrieval

The app must retrieve:

- dispute ID, status, amount, reason, due dates
- order ID, customer info required for dispute ops
- line items
- fulfillment and shipment events
- refund and transaction history
- order risk indicators where available

### 9.4 Dispute Workspace

Each dispute page must show:

- dispute summary
- due date and SLA state
- dispute reason and bank-facing context
- order and customer snapshot
- timeline of dispute events
- evidence checklist
- uploaded files
- packet preview
- submission state
- outcome state

### 9.5 Evidence Vault

Must support:

- normalized evidence categories
- file uploads
- metadata tagging
- evidence descriptions
- audit log for all changes

### 9.6 Packet Generation

Must generate:

- one PDF summary packet
- structured evidence sections
- merchant-editable narrative
- exportable archive of files

### 9.7 Alerts and Tasking

Must support:

- new dispute alert
- due-soon alert
- missing evidence alert
- overdue or at-risk state

### 9.8 Analytics

Dashboard metrics:

- open disputes
- due this week
- won/lost/accepted
- total disputed amount
- recovered amount
- reason distribution
- evidence completeness trends

### 9.9 Prevention Recommendations

Rules-based v1 recommendations:

- use signature confirmation for risky shipments
- improve visible refund and return policy placement
- follow up on delayed fulfillment
- review high-risk order patterns
- review statement descriptor and customer service contact visibility

### 9.10 Partner Marketplace

V1 requirements:

- recommendations page
- partner profiles
- tagging by use case
- clear sponsored disclosure
- lead capture with merchant consent

## 10. Non-Functional Requirements

### 10.1 Security

- encrypt tokens and sensitive evidence metadata at rest
- use TLS everywhere
- role-based internal access
- audit logs for admin actions
- HMAC verification on all webhooks

### 10.2 Performance

- webhook acknowledgment under 5 seconds
- background jobs for all non-trivial processing
- dashboard initial load under 2 seconds for typical merchants
- evidence packet generation under 30 seconds for most disputes

### 10.3 Reliability

- idempotent webhook processing
- retry-safe background jobs
- dead-letter handling for failed ingestion
- file processing retries

### 10.4 Scalability

- support at least 10,000 disputes per month across merchants in initial architecture
- queue-based async processing
- object storage for documents

### 10.5 Observability

- structured logs
- webhook failure alerts
- job queue monitoring
- API error tracking
- business metrics instrumentation

## 11. Shopify API and Platform Specifications

### 11.1 Admin APIs

Use GraphQL Admin API as the primary application data layer.

V1 will rely on Shopify Admin APIs for:

- disputes query and single dispute retrieval
- Shopify Payments dispute fields
- order details
- fulfillment details
- transactions and refunds

### 11.2 Webhook Topics

Core topics:

- `disputes/create`
- `disputes/update`

Additional useful topics:

- `orders/risk_assessment_changed`
- `orders/updated`
- `app/uninstalled`
- privacy webhooks

### 11.3 Access Scopes

Expected scopes to validate during build:

- `read_shopify_payments_disputes`
- write scope for dispute evidence where applicable
- `read_orders`
- `read_all_orders` if historical access is required and approved
- any additional Shopify Payments-related scopes needed for dispute evidence operations

Final scope selection must be minimized to improve app review approval odds.

### 11.4 File Upload and Evidence Submission

The evidence update path must be validated in a prototype. The engineering team must verify:

- file upload flow
- supported file types
- size limits
- evidence field mappings
- whether `submitEvidence` fully completes the intended merchant workflow

Until validated in implementation, product copy must not promise one-click automated submission.

## 12. System Architecture

### 12.1 Recommended Stack

Recommended practical stack:

- Frontend: Remix or Next.js embedded Shopify app
- UI: Polaris
- Backend: Node.js with TypeScript
- Database: PostgreSQL
- Queue: BullMQ, Cloud Tasks, or equivalent job system
- Cache: Redis
- File storage: S3-compatible object storage
- PDF generation: headless Chromium or server-side PDF service

### 12.2 High-Level Components

- Shopify app frontend
- API server
- webhook ingestion service
- background worker service
- dispute orchestration engine
- evidence vault service
- PDF generation service
- analytics service
- partner marketplace module

### 12.3 Reference Architecture

```text
Shopify Webhooks
  -> Webhook Receiver
  -> Queue
  -> Dispute Sync Worker
  -> PostgreSQL
  -> Evidence Assembly Worker
  -> File Storage
  -> PDF Generator
  -> Embedded App UI
```

### 12.4 Processing Model

- Receive webhook
- store raw event metadata
- enqueue sync job
- fetch latest dispute snapshot from Shopify
- upsert dispute record
- trigger evidence assembly jobs
- mark readiness state

## 13. Data Model Specification

### 13.1 Core Entities

#### Merchant

- id
- shop domain
- shopify shop id
- plan type
- installed at
- uninstalled at
- timezone
- settings

#### Dispute

- id
- merchant id
- shopify dispute id
- shopify order id
- status
- type
- reason
- reason details
- amount
- currency
- evidence due by
- evidence sent on
- initiated at
- finalized on
- source snapshot

#### Dispute Timeline Event

- id
- dispute id
- event type
- event timestamp
- source
- payload summary

#### Order Snapshot

- id
- merchant id
- shopify order id
- customer identifiers required for ops
- order total
- currency
- fulfillment state
- risk state
- order json snapshot

#### Evidence Item

- id
- dispute id
- category
- source type
- title
- description
- file url
- file mime type
- structured value
- readiness state
- created by
- created at

#### Evidence Packet

- id
- dispute id
- version
- status
- summary text
- pdf url
- generated at
- submitted at

#### Prevention Recommendation

- id
- merchant id
- dispute id nullable
- category
- recommendation text
- priority
- state

#### Partner Lead Event

- id
- merchant id
- partner id
- placement
- event type
- created at

### 13.2 Suggested Evidence Categories

- shipping documentation
- delivery confirmation
- refund proof
- customer communication
- service documentation
- product listing proof
- policy acceptance or policy disclosure
- account usage or access logs
- uncategorized supporting evidence

## 14. Evidence Strategy

### 14.1 Shopify-Native Evidence Sources in V1

- order confirmation details
- line items and prices
- fulfillment records
- tracking numbers
- refund transactions
- transaction metadata
- customer contact details required for dispute handling
- order risk data if available

### 14.2 Merchant-Supplied Evidence

- customer emails or support exports
- carrier screenshots or signed proof
- service completion documentation
- custom policy screenshots
- notes and explanations

### 14.3 Evidence Completeness Rules

For each dispute reason, define required and recommended evidence. Example:

Fraud:

- required:
  - order details
  - fulfillment details
  - delivery confirmation if shipped
- recommended:
  - customer communication
  - prior order history
  - risk indicators

Product not received:

- required:
  - tracking and delivery proof
- recommended:
  - carrier communication
  - address verification

Product unacceptable:

- required:
  - product details and fulfillment proof
- recommended:
  - product listing proof
  - quality control or pre-shipment evidence
  - support resolution attempts

## 15. UX Specification

### 15.1 Main Screens

- onboarding and permissions
- disputes dashboard
- dispute detail workspace
- evidence library
- packet preview
- analytics dashboard
- recommendations page
- settings and compliance controls
- partner marketplace

### 15.2 Disputes Dashboard

Must support:

- table and filtered views
- status badges
- due date urgency
- reason filters
- amount filters
- evidence completeness indicator

### 15.3 Dispute Detail Workspace

Sections:

- overview
- timeline
- evidence checklist
- file uploads
- narrative editor
- packet preview
- submission panel
- outcome and learnings

### 15.4 Merchant Trust Requirements

The UI must clearly state:

- the bank decides the outcome
- the app improves preparation, not final issuer control
- evidence should be accurate and not misleading

## 16. Compliance and Privacy Specification

### 16.1 Protected Customer Data

The app should assume it handles protected customer data. Engineering and product must:

- collect only necessary fields
- document data usage clearly
- secure data storage and transfer
- enforce deletion and retention policies
- prepare for Shopify protected customer data review

### 16.2 Mandatory Compliance Webhooks

Implement:

- customer data request webhook
- customer redact webhook
- shop redact webhook

These must be tested before public app submission.

### 16.3 Retention Policy

Recommended v1 policy:

- raw webhook payload metadata: 90 days
- evidence files: configurable default 12 months
- analytics aggregates: long-lived if de-identified
- deleted merchant data: purge according to policy and Shopify requirements

### 16.4 Security Controls

- AES encryption for sensitive stored values
- KMS-managed secrets where possible
- short-lived signed URLs for file access
- internal admin access logging
- least-privilege service roles

## 17. Technical Risks and Mitigations

### 17.1 Shopify API Version Changes

Risk:

- dispute resources or scopes may evolve

Mitigation:

- pin supported API version
- schedule quarterly API review

### 17.2 File Upload Complexity

Risk:

- evidence file workflows may be constrained by size and type limits

Mitigation:

- validate early
- compress where appropriate
- provide merchant guidance before upload

### 17.3 Missing Data

Risk:

- not enough evidence exists in Shopify alone

Mitigation:

- build upload-friendly workflow
- expose missing evidence checklist clearly

### 17.4 Merchant Expectation Risk

Risk:

- merchants may expect guaranteed win rates

Mitigation:

- careful positioning in product and sales copy

## 18. Delivery Roadmap

### Phase 0: Discovery and Prototype

Duration:

- 2 weeks

Deliverables:

- validate Shopify dispute objects and webhook subscriptions
- confirm scopes and app review implications
- prototype evidence update and submission path
- define final v1 API boundary

Exit criteria:

- successful dispute ingestion
- successful dispute sync
- evidence write path understood
- compliance checklist drafted

### Phase 1: Core Backend and Data Layer

Duration:

- 3 weeks

Deliverables:

- OAuth and app install flow
- merchant model
- dispute model
- webhook receiver
- idempotent sync jobs
- GraphQL dispute and order sync

Exit criteria:

- disputes appear reliably in database
- retries and failure handling work

### Phase 2: Dispute Workspace and Evidence Vault

Duration:

- 4 weeks

Deliverables:

- dashboard
- dispute detail page
- evidence categories
- file upload system
- completeness engine
- packet generation v1

Exit criteria:

- merchant can review and organize dispute evidence end to end

### Phase 3: Submission Workflow and Analytics

Duration:

- 3 weeks

Deliverables:

- evidence submission path if validated
- manual-submit guidance fallback
- analytics dashboard
- alerting and due-date workflows

Exit criteria:

- merchant can complete a dispute workflow in production-safe manner

### Phase 4: Compliance, Hardening, and App Review

Duration:

- 2 weeks

Deliverables:

- privacy webhooks
- retention controls
- security review
- app review copy
- billing plan setup

Exit criteria:

- app is submission-ready for Shopify review

### Phase 5: Beta Launch

Duration:

- 2 to 4 weeks

Deliverables:

- pilot merchants
- metrics instrumentation
- feedback loop
- roadmap adjustments

## 19. Suggested MVP Milestones

### Milestone 1

- app installs successfully
- webhooks registered
- disputes appear in dashboard

### Milestone 2

- order context attached to disputes
- evidence checklist generated

### Milestone 3

- files uploaded
- packet PDF generated

### Milestone 4

- submission flow enabled or manual fallback shipped
- analytics active

### Milestone 5

- app review package complete
- first beta merchants onboarded

## 20. Engineering Backlog Seed

### Backend

- create OAuth flow
- create merchant installation persistence
- create webhook verification middleware
- implement dispute sync worker
- implement order snapshot worker
- implement evidence item service
- implement PDF generation service
- implement privacy webhook handlers

### Frontend

- build onboarding
- build dashboard
- build dispute detail view
- build evidence upload UX
- build packet preview
- build analytics dashboard
- build settings pages

### Platform

- provision database
- provision queue
- provision object storage
- implement observability stack
- configure secret management

### Compliance

- privacy policy draft
- data retention policy
- data deletion flows
- app review evidence package

## 21. QA and Testing Strategy

### 21.1 Automated Tests

- webhook signature validation tests
- webhook idempotency tests
- dispute sync unit tests
- GraphQL client contract tests
- evidence completeness engine tests
- file upload validation tests
- PDF generation smoke tests

### 21.2 Manual Testing

- install and uninstall flow
- webhook failure and retry
- dispute detail rendering
- file upload edge cases
- due-date alerting
- privacy webhook handling

### 21.3 Beta Validation Metrics

- average time from dispute creation to evidence-ready state
- percentage of disputes with complete evidence packets
- percentage of disputes submitted before due date
- merchant satisfaction with workflow clarity

## 22. Pricing and Packaging Recommendation

### Starter

- manual evidence workspace
- dashboard
- PDF packet generation

### Growth

- automated evidence assembly
- alerts
- analytics
- team workflows

### Later Add-On

- partner-integrated risk stack referrals
- advanced automations

Do not launch performance-based pricing until:

- recovered value is measured accurately
- attribution is defensible
- terms are clear

## 23. Go-To-Market Positioning

Recommended positioning:

"A Shopify Payments dispute operations co-pilot that helps merchants respond faster, stay organized, and submit stronger evidence."

Avoid claims such as:

- guaranteed chargeback recovery
- guaranteed reduced disputes
- issuer outcome control

## 24. Open Questions Requiring Early Validation

- Which exact scopes are required for all evidence write operations?
- Does the evidence submission path behave consistently across stores and dispute states?
- What file limits and edge cases materially affect merchant workflows?
- Should support-system integrations be deferred completely from v1 or included for one vendor?
- Is Shopify App Store review comfortable with the requested dispute and customer-data scope set?

## 25. Recommended Immediate Next Steps

1. Create a technical spike app and validate webhook + dispute sync.
2. Prototype evidence upload and submission against a development store.
3. Finalize the minimum viable scope based on submission-path validation.
4. Convert this document into:
   - product requirements document
   - technical architecture spec
   - sprint backlog
   - app review checklist

## 26. Final Recommendation

Build this as a Shopify Payments-first operations product, not as a universal chargeback automation platform on day one. The strongest v1 is a reliable dispute intake, evidence assembly, and packet-generation workflow with careful compliance posture and explicit merchant expectation management.

If executed with that constraint, the app is commercially credible and technically achievable.
