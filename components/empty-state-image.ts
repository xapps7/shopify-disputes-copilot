/**
 * Polaris `EmptyState` requires an `image`. Several call sites passed `image=""`,
 * which renders a broken `<img>` (a missing-image icon and an accessibility
 * error). This inline SVG data URI is self-contained, so it also works with a
 * strict embedded-app CSP and offline.
 */
const EMPTY_STATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" role="presentation" focusable="false">
  <rect x="26" y="16" width="68" height="88" rx="8" fill="#F1F2F4" stroke="#C9CCCF" stroke-width="2"/>
  <rect x="40" y="38" width="40" height="6" rx="3" fill="#C9CCCF"/>
  <rect x="40" y="54" width="40" height="6" rx="3" fill="#DFE3E8"/>
  <rect x="40" y="70" width="26" height="6" rx="3" fill="#DFE3E8"/>
</svg>`;

export const EMPTY_STATE_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(EMPTY_STATE_SVG)}`;
