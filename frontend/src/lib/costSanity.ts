/**
 * Sanity checks for scope-item unit cost and line totals. Produces a warning
 * level + short message the UI can surface on suspicious rows.
 *
 * These are deliberately loose — we only flag *clearly* out-of-band costs so
 * users aren't nagged about legitimately expensive items. The user can ignore.
 */

import type { ScopeItem } from "./api";

export type CostWarningLevel = "none" | "warn" | "alert";

export type CostWarning = {
  level: CostWarningLevel;
  message: string;
};

// Keyword → ceiling for the per-UNIT cost (one sconce, one chair, one sqft, etc.)
// Anything above the "alert" ceiling is almost certainly a bug or typo.
// Anything between "warn" and "alert" is unusual but not impossible.
type UnitBand = { warn: number; alert: number; noun: string };
const UNIT_BANDS: Array<{ match: RegExp; band: UnitBand }> = [
  { match: /\b(sconce|lamp|pendant|picture light|reading light|wall light)\b/i,
    band: { warn: 2000, alert: 6000, noun: "lighting fixture" } },
  { match: /\bchandelier\b/i,
    band: { warn: 20000, alert: 60000, noun: "chandelier" } },
  { match: /\bnightstand|side table|end table\b/i,
    band: { warn: 2500, alert: 6000, noun: "nightstand/side table" } },
  { match: /\bdresser|credenza|desk\b/i,
    band: { warn: 6000, alert: 15000, noun: "dresser/desk/credenza" } },
  { match: /\bbed (frame|base)|headboard\b/i,
    band: { warn: 8000, alert: 20000, noun: "bed/headboard" } },
  { match: /\b(sofa|sectional|sleeper)\b/i,
    band: { warn: 12000, alert: 30000, noun: "sofa/sectional" } },
  { match: /\b(chair|ottoman|bench|stool)\b/i,
    band: { warn: 4000, alert: 10000, noun: "chair/bench" } },
  { match: /\bdrapery|sheers|pillow|duvet|bedspread|bed scarf|cushion|bath linen|bed linen\b/i,
    band: { warn: 3500, alert: 8000, noun: "soft goods" } },
  { match: /\bmirror|artwork|decorative object|vase|accessor\b/i,
    band: { warn: 3000, alert: 8000, noun: "accessory" } },
  { match: /\btowel bar|robe hook|tissue holder|bath accessor\b/i,
    band: { warn: 500, alert: 1500, noun: "bath accessory" } },
  { match: /\btub(?! shower)|freestanding tub\b/i,
    band: { warn: 20000, alert: 45000, noun: "tub" } },
  { match: /\bvanity.*(mirror|sink|faucet|top|stool)|vanity\b/i,
    band: { warn: 15000, alert: 40000, noun: "vanity" } },
  { match: /\b(tv|television|in-room tv)\b/i,
    band: { warn: 5000, alert: 10000, noun: "TV" } },
  { match: /\bmillwork|wardrobe|etagere|étagère|wet bar|cabinet\b/i,
    band: { warn: 40000, alert: 120000, noun: "millwork/cabinet" } },
];


export function checkCostSanity(
  item: ScopeItem,
  acknowledgedIds?: Set<string>,
): CostWarning {
  // User can explicitly "accept" a flagged item — the cost is intentional and
  // the warning should stop showing up. Acknowledgements are persisted to
  // localStorage per-property (see loadAcknowledgedIds / addAcknowledgement).
  if (acknowledgedIds?.has(item.id)) return { level: "none", message: "" };

  const unitCost = item.effective_unit_cost || 0;
  const lineTotal = item.line_total || 0;

  if (unitCost <= 0) return { level: "none", message: "" };

  // 1) Category-specific unit-cost bounds.
  const hay = `${item.line_item || ""} ${item.description || ""}`.toLowerCase();
  for (const { match, band } of UNIT_BANDS) {
    if (match.test(hay)) {
      if (unitCost > band.alert) {
        return {
          level: "alert",
          message: `Unit cost ${formatCurrency(unitCost)} is ${(unitCost / band.warn).toFixed(1)}× the typical ceiling for a ${band.noun} (~${formatCurrency(band.warn)}). Likely a typo or mis-estimated.`,
        };
      }
      if (unitCost > band.warn) {
        return {
          level: "warn",
          message: `Unit cost ${formatCurrency(unitCost)} is high for a ${band.noun} (typical ≤${formatCurrency(band.warn)}).`,
        };
      }
      break; // First matching band wins; don't fall through to generic checks.
    }
  }

  // 2) Generic line-total guardrails (catches any category we didn't name).
  if (lineTotal > 10_000_000) {
    return {
      level: "alert",
      message: `Line total ${formatCurrency(lineTotal)} exceeds $10M — review before approving.`,
    };
  }
  if (lineTotal > 3_000_000) {
    return {
      level: "warn",
      message: `Line total ${formatCurrency(lineTotal)} is very high — verify quantity × unit cost.`,
    };
  }
  return { level: "none", message: "" };
}


// ─── Acknowledged-flag persistence (per property, localStorage) ─────
const ACK_KEY_PREFIX = "pipbudget.costSanityAcknowledged.";

export function loadAcknowledgedIds(propertyId: string): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_KEY_PREFIX + propertyId);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function saveAcknowledgedIds(propertyId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(ACK_KEY_PREFIX + propertyId, JSON.stringify(Array.from(ids)));
  } catch { /* ignore quota errors */ }
}


function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n);
}
