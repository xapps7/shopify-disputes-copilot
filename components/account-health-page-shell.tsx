"use client";

import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  DataTable,
  Divider,
  InlineGrid,
  InlineStack,
  List,
  ProgressBar,
  Text
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { formatMoney } from "@/lib/format/money";
import type { AccountHealth } from "@/lib/economics/account-health";

/**
 * The second scoreboard.
 *
 * There are two, and merchants are only ever shown the first. Representment -
 * fighting a chargeback - decides whether the money comes back. Visa's VAMP and
 * Mastercard's ECM ratios decide whether the shop keeps card processing at all.
 * Winning a case moves the first and does nothing whatsoever to the second: the
 * chargeback still happened, and the networks still count it. A merchant can
 * win every dispute they fight and still be put into a monitoring programme.
 *
 * So this screen never leads with a number. It leads with the verdict, in
 * words, because "1.4%" means nothing without the threshold beside it, and
 * because the honest answer is sometimes "we cannot tell" - which a meter
 * cannot say.
 *
 * Everything the data cannot see is printed near the top rather than in a
 * footnote. Shopify's API does not expose TC40 fraud reports, so the Visa
 * number here is a floor, not a measurement. A health screen that projects
 * confidence it has not earned is worse than no health screen.
 */

type AccountHealthPageShellProps = {
  health: AccountHealth;
};

/**
 * Derived from the imported contract rather than restated here, so a change on
 * the data side shows up as a type error on this page instead of as a silently
 * stale copy of the shape.
 */
type RatioAssessment = NonNullable<AccountHealth["vamp"]>;
type PortfolioEntry = AccountHealth["portfolio"][number];
type PreventionAction = AccountHealth["recommendations"][number];

/** Pinned so the server and client renders of these figures agree. */
const RATIO_LOCALE = "en-US";

const NETWORK_NAME: Record<RatioAssessment["program"], string> = {
  VAMP: "Visa",
  ECM: "Mastercard"
};

const PROGRAM_TITLE: Record<RatioAssessment["program"], string> = {
  VAMP: "Visa VAMP",
  ECM: "Mastercard ECM"
};

/** What the programme actually counts, so the numerator is never a mystery. */
const COUNTED_NOUN: Record<RatioAssessment["program"], { one: string; many: string }> = {
  VAMP: { one: "dispute or fraud report", many: "disputes and fraud reports" },
  ECM: { one: "chargeback", many: "chargebacks" }
};

/** Status in words first. Colour only ever repeats what the word already said. */
const STATUS_WORD: Record<RatioAssessment["status"], string> = {
  healthy: "Healthy",
  watch: "Watch",
  breach: "Over threshold"
};

const STATUS_BADGE_TONE: Record<RatioAssessment["status"], "success" | "attention" | "critical"> = {
  healthy: "success",
  watch: "attention",
  breach: "critical"
};

const METER_TONE: Record<RatioAssessment["status"], "success" | "primary" | "critical"> = {
  healthy: "success",
  watch: "primary",
  breach: "critical"
};

function formatRatio(value: number): string {
  return new Intl.NumberFormat(RATIO_LOCALE, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(RATIO_LOCALE).format(value);
}

/** How full the meter is, as a share of the threshold rather than of 100%. */
function meterPercent(assessment: RatioAssessment): number {
  if (assessment.ratioThreshold <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((assessment.ratio / assessment.ratioThreshold) * 100)));
}

/** "about 140 more disputes this month before you'd breach" — a sentence, not a stat. */
function headroomSentence(assessment: RatioAssessment): string {
  const network = NETWORK_NAME[assessment.program];
  const noun = COUNTED_NOUN[assessment.program];

  if (assessment.headroom <= 0) {
    return `No headroom left: you are already at or above ${network}'s ${formatRatio(
      assessment.ratioThreshold
    )} ratio. What is keeping you out of the programme is the count — ${network} also requires at least ${formatCount(
      assessment.countThreshold
    )} ${noun.many} in the month.`;
  }

  return `About ${formatCount(assessment.headroom)} more ${
    assessment.headroom === 1 ? noun.one : noun.many
  } this month before you'd breach.`;
}

function projectionSentence(assessment: RatioAssessment): string | null {
  if (assessment.projectedRatio === null) {
    return null;
  }

  const projected = formatRatio(assessment.projectedRatio);
  const threshold = formatRatio(assessment.ratioThreshold);

  return assessment.projectedRatio >= assessment.ratioThreshold
    ? `At this pace the month ends near ${projected}, which is over ${NETWORK_NAME[assessment.program]}'s ${threshold} threshold.`
    : `At this pace the month ends near ${projected}, still under ${NETWORK_NAME[assessment.program]}'s ${threshold} threshold.`;
}

type Verdict = {
  /** The status word, first, before any figure. */
  headline: string;
  badge: string;
  tone: "success" | "attention" | "critical" | undefined;
  /** What it means for the merchant, in one sentence. */
  meaning: string;
  /** The figures, second. Empty when nothing could be measured. */
  figures: string[];
};

function listPossessives(networks: string[]): string {
  if (networks.length === 1) {
    return `${networks[0]}'s threshold`;
  }
  return `${networks.slice(0, -1).join(", ")} and ${networks[networks.length - 1]}'s thresholds`;
}

/**
 * The verdict is derived from the worst status either programme is in, and it
 * names the programme that is in it. "You are fine except for one network" is
 * not a thing that exists: either network can end card acceptance on its own.
 */
function buildVerdict(health: AccountHealth): Verdict {
  const assessments = [health.vamp, health.ecm].filter((entry): entry is RatioAssessment => entry !== null);

  const figures = assessments.map(
    (assessment) =>
      `${PROGRAM_TITLE[assessment.program]}: ${formatRatio(assessment.ratio)} against a ${formatRatio(
        assessment.ratioThreshold
      )} threshold, from ${formatCount(assessment.count)} ${
        assessment.count === 1 ? COUNTED_NOUN[assessment.program].one : COUNTED_NOUN[assessment.program].many
      }.`
  );

  if (assessments.length === 0) {
    return {
      headline: "We cannot tell whether your card processing is at risk",
      badge: "Not measurable",
      tone: undefined,
      meaning:
        "Neither ratio could be calculated for this period, because the order volume they divide by could not be read. An unknown ratio is not a safe ratio — treat the prevention work below as if it matters, because it does.",
      figures
    };
  }

  const breaching = assessments.filter((assessment) => assessment.status === "breach");
  if (breaching.length > 0) {
    return {
      headline: `Over ${listPossessives(breaching.map((assessment) => NETWORK_NAME[assessment.program]))}`,
      badge: "Over threshold",
      tone: "critical",
      meaning:
        "This is the range where the network can place your account in a monitoring programme: per-dispute fees, a remediation plan, and in the worst case the loss of card processing. Winning the open cases will not pull you out of it — only fewer chargebacks will.",
      figures
    };
  }

  const watching = assessments.filter((assessment) => assessment.status === "watch");
  if (watching.length > 0) {
    return {
      headline: `Getting close to ${listPossessives(watching.map((assessment) => NETWORK_NAME[assessment.program]))}`,
      badge: "Watch",
      tone: "attention",
      meaning:
        "Nothing has been triggered yet. This is the month to act, because the only thing that lowers these ratios is fewer chargebacks next month — fighting the ones you already have does not move them.",
      figures
    };
  }

  return {
    headline: "Your card processing is not at risk",
    badge: "Healthy",
    tone: "success",
    meaning:
      "Both monitoring programmes have room in them at your current volume. Keep an eye on it if your sales fall: the Mastercard ratio worsens on falling sales alone, without a single extra chargeback.",
    figures
  };
}

/** Why a ratio could not be produced, in terms of the volume that was missing. */
function missingRatioReason(program: RatioAssessment["program"], health: AccountHealth): string {
  if (program === "VAMP") {
    return health.ordersThisMonth === null
      ? `Visa divides this month's disputes and fraud reports by this month's settled card-not-present transactions. We could not read your order volume for ${health.periodLabel}, so there is no denominator and no honest ratio to show.`
      : `Visa's ratio could not be calculated for ${health.periodLabel}. Rather than show you a number we cannot stand behind, this meter stays empty.`;
  }

  return health.ordersPriorMonth === null
    ? `Mastercard divides this month's chargebacks by LAST month's captured payments. We could not read your prior-month order volume, so there is no denominator and no honest ratio to show.`
    : `Mastercard's ratio could not be calculated for ${health.periodLabel}. Rather than show you a number we cannot stand behind, this meter stays empty.`;
}

function ProgramCard({ assessment }: { assessment: RatioAssessment }) {
  const network = NETWORK_NAME[assessment.program];
  const noun = COUNTED_NOUN[assessment.program];
  const meterLabelId = `account-health-meter-${assessment.program.toLowerCase()}`;
  const projection = projectionSentence(assessment);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text as="h2" variant="headingMd">
            {PROGRAM_TITLE[assessment.program]}
          </Text>
          <Badge tone={STATUS_BADGE_TONE[assessment.status]}>{STATUS_WORD[assessment.status]}</Badge>
        </InlineStack>

        <BlockStack gap="150">
          <Text as="p" variant="bodyMd" id={meterLabelId}>
            {`${formatRatio(assessment.ratio)} against ${network}'s ${formatRatio(
              assessment.ratioThreshold
            )} threshold`}
          </Text>
          <ProgressBar
            ariaLabelledBy={meterLabelId}
            progress={meterPercent(assessment)}
            tone={METER_TONE[assessment.status]}
          />
          <Text as="p" variant="bodySm" tone="subdued">
            {`The bar is how far you are along to ${network}'s threshold, not a share of your orders.`}
          </Text>
        </BlockStack>

        <BlockStack gap="100">
          <Text as="p" variant="bodyMd">
            {`${formatCount(assessment.count)} ${
              assessment.count === 1 ? noun.one : noun.many
            } counted this month.`}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {`${network} acts only when both are true: the ratio is at or above ${formatRatio(
              assessment.ratioThreshold
            )} and the count reaches ${formatCount(
              assessment.countThreshold
            )}. A small shop with a bad ratio and a handful of chargebacks is not in danger; a large one with a good ratio can still cross on count.`}
          </Text>
        </BlockStack>

        <Text as="p" variant="bodyMd" fontWeight="medium">
          {headroomSentence(assessment)}
        </Text>

        {projection ? (
          <Text as="p" variant="bodyMd">
            {projection}
          </Text>
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">
            Too little of the month has passed to project where it ends up without guessing.
          </Text>
        )}

        <Box background="bg-surface-secondary" borderRadius="200" padding="300">
          <BlockStack gap="100">
            <Text as="h3" variant="headingXs">
              {`How ${network} counts this`}
            </Text>
            {/* Verbatim: this sentence carries the prior-month denominator trap. */}
            <Text as="p" variant="bodySm">
              {assessment.explanation}
            </Text>
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}

function UnmeasurableProgramCard({
  program,
  health
}: {
  program: RatioAssessment["program"];
  health: AccountHealth;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text as="h2" variant="headingMd">
            {PROGRAM_TITLE[program]}
          </Text>
          <Badge>Not measurable</Badge>
        </InlineStack>

        <Text as="p" variant="bodyMd">
          {missingRatioReason(program, health)}
        </Text>

        <Text as="p" variant="bodySm" tone="subdued">
          {`${health.disputesThisMonth === 1 ? "1 dispute has" : `${formatCount(health.disputesThisMonth)} disputes have`} been recorded in ${health.periodLabel}. That count is real; it is the volume to divide it by that is missing.`}
        </Text>
      </BlockStack>
    </Card>
  );
}

export function AccountHealthPageShell({ health }: AccountHealthPageShellProps) {
  const verdict = buildVerdict(health);
  const monthElapsedPercent = Math.round(Math.min(1, Math.max(0, health.monthElapsed)) * 100);

  return (
    <AdminPageLayout
      title="Account health"
      subtitle="Whether you keep card processing. This is a different question from whether you win your disputes — winning gets the money back and leaves these ratios exactly where they were."
      gap="400"
    >
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
            <BlockStack gap="100">
              {/* Verdict first, in words. The figures come after it, never instead of it. */}
              <Text as="h2" variant="headingLg">
                {verdict.headline}
              </Text>
              <Text as="p" variant="bodyMd">
                {verdict.meaning}
              </Text>
            </BlockStack>
            <Badge tone={verdict.tone}>{verdict.badge}</Badge>
          </InlineStack>

          {verdict.figures.length > 0 ? (
            <BlockStack gap="050">
              {verdict.figures.map((figure) => (
                <Text as="p" key={figure} variant="bodySm" tone="subdued">
                  {figure}
                </Text>
              ))}
            </BlockStack>
          ) : null}

          <Divider />

          <Text as="p" variant="bodySm" tone="subdued">
            {`${health.periodLabel} · ${
              health.disputesThisMonth === 1 ? "1 dispute" : `${formatCount(health.disputesThisMonth)} disputes`
            } so far · about ${monthElapsedPercent}% of the month gone · ${
              health.ordersThisMonth === null
                ? "order volume for this month could not be measured"
                : `${formatCount(health.ordersThisMonth)} orders this month`
            }${
              health.ordersPriorMonth === null
                ? ", prior month could not be measured"
                : `, ${formatCount(health.ordersPriorMonth)} last month`
            }`}
          </Text>
        </BlockStack>
      </Card>

      {/*
        Near the top, deliberately. Every one of these is a reason the numbers
        above understate the risk rather than overstate it.
      */}
      {health.caveats.length > 0 ? (
        <Banner tone="info" title="What these numbers can and cannot see">
          <BlockStack gap="200">
            <p>
              Every limitation below points the same way: the real position can be worse than what is shown above,
              never better. Read the meters as a floor.
            </p>
            <List>
              {health.caveats.map((caveat: string) => (
                <List.Item key={caveat}>{caveat}</List.Item>
              ))}
            </List>
          </BlockStack>
        </Banner>
      ) : null}

      {health.protectWarning ? (
        <Banner tone="warning" title="Shopify Protect gave the money back. It did not remove the chargeback.">
          <p>{health.protectWarning}</p>
        </Banner>
      ) : null}

      {/*
        Side by side, not stacked. The two programmes are read against each
        other - a shop can be healthy on one and over the threshold on the
        other, and that comparison is the point. Stacked they were two screens
        of scrolling with the comparison held in the merchant's head.
      */}
      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        {health.vamp ? <ProgramCard assessment={health.vamp} /> : <UnmeasurableProgramCard program="VAMP" health={health} />}
        {health.ecm ? <ProgramCard assessment={health.ecm} /> : <UnmeasurableProgramCard program="ECM" health={health} />}
      </InlineGrid>

      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Money at risk right now
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              One row per currency. Currencies are never added together — a single combined figure would be a number
              that does not exist.
            </Text>
          </BlockStack>

          {health.portfolio.length > 0 ? (
            <DataTable
              columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
              headings={["Currency", "Open disputes", "At risk", "Realistically recoverable", "Worth fighting"]}
              rows={health.portfolio.map((entry: PortfolioEntry) => [
                entry.currencyCode,
                formatCount(entry.count),
                formatMoney(entry.atRisk, entry.currencyCode),
                formatMoney(entry.recoverable, entry.currencyCode),
                formatCount(entry.worthFighting)
              ])}
            />
          ) : (
            <Text as="p" variant="bodyMd">
              No open disputes, so there is no money at risk today. The ratios above still count everything that has
              already happened this month.
            </Text>
          )}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              Prevention
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              This is the half of the screen that moves the numbers above. Every dispute you avoid comes out of next
              month&rsquo;s ratio; every dispute you win does not.
            </Text>
          </BlockStack>

          {health.recommendations.length > 0 ? (
            <BlockStack gap="300">
              {health.recommendations.map((recommendation: PreventionAction, index: number) => (
                <BlockStack gap="200" key={recommendation.id}>
                  <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">
                        {recommendation.title}
                      </Text>
                      <div className="recommendation-copy">
                        <Text as="p" variant="bodyMd" tone="subdued">
                          {recommendation.detail}
                        </Text>
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {recommendation.state.replaceAll("_", " ").toLowerCase()}
                      </Text>
                    </BlockStack>
                    <Badge>{`Priority ${recommendation.priority.replaceAll("_", " ").toLowerCase()}`}</Badge>
                  </InlineStack>
                  {index < health.recommendations.length - 1 ? <Divider /> : null}
                </BlockStack>
              ))}
            </BlockStack>
          ) : (
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Nothing here yet — and that is a gap in what the app knows, not a clean bill of health.
              </Text>
              <Text as="p" variant="bodyMd">
                Prevention actions are generated from decided disputes. Open a dispute that has been won or lost,
                record the outcome and the reason it went that way, and the pattern behind it — a delivery gap, a
                billing descriptor customers do not recognise, a subscription renewal nobody expected — becomes an
                action on this page.
              </Text>
            </BlockStack>
          )}
        </BlockStack>
      </Card>
    </AdminPageLayout>
  );
}
