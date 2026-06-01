/**
 * Property-level budget sanity guardrails.
 *
 * Typical 2026 US per-key renovation ranges by brand tier. Used to flag when
 * an estimated total is wildly outside the plausible band so the user can
 * catch bad cost data early — e.g. a stale DB match that multiplied a luxury
 * unit cost across every key, producing hundreds of millions.
 */

export type BrandTier = "luxury" | "upper_upscale" | "upscale" | null | string;

export type PerKeyBand = {
  low: number;
  typical_low: number;
  typical_high: number;
  high: number;
};

const BANDS: Record<string, PerKeyBand> = {
  // Wide "possible" range; narrower "typical" band for the healthy middle.
  luxury: { low: 80_000, typical_low: 120_000, typical_high: 220_000, high: 300_000 },
  upper_upscale: { low: 25_000, typical_low: 40_000, typical_high: 90_000, high: 140_000 },
  upscale: { low: 12_000, typical_low: 20_000, typical_high: 45_000, high: 70_000 },
};

export type BudgetVerdict = {
  level: "ok" | "info" | "warn" | "alert";
  message: string;
  band?: PerKeyBand;
  tier_label: string;
};


export function checkBudgetSanity(
  total: number,
  keys: number,
  tier: BrandTier,
): BudgetVerdict {
  if (!keys || keys <= 0) {
    return {
      level: "info",
      message: "Keys not set — can't compare to a per-key band. Enter the key count on Setup.",
      tier_label: String(tier ?? "unknown"),
    };
  }
  const normalizedTier = (tier ?? "").toString().toLowerCase().replace(/\s+/g, "_");
  const band = BANDS[normalizedTier];
  if (!band) {
    return {
      level: "info",
      message: `Brand tier not set — total is $${round(total).toLocaleString()} (${formatKeyRate(total, keys)}). Set a target brand tier on Setup for a sanity comparison.`,
      tier_label: String(tier ?? "unknown"),
    };
  }

  const perKey = total / keys;
  const tierLabel = normalizedTier.replace(/_/g, " ");

  if (total === 0) {
    return {
      level: "info",
      message: `No costs assigned yet. Typical ${tierLabel} renovation: $${band.typical_low.toLocaleString()}–$${band.typical_high.toLocaleString()}/key.`,
      band, tier_label: tierLabel,
    };
  }

  if (perKey > band.high) {
    return {
      level: "alert",
      message: `${formatKeyRate(total, keys)} is ${(perKey / band.typical_high).toFixed(1)}× the typical ${tierLabel} ceiling ($${band.typical_high.toLocaleString()}/key). Almost certainly a bad cost match or runaway AI estimate — review the biggest line items.`,
      band, tier_label: tierLabel,
    };
  }
  if (perKey > band.typical_high) {
    return {
      level: "warn",
      message: `${formatKeyRate(total, keys)} is above the typical ${tierLabel} range ($${band.typical_low.toLocaleString()}–$${band.typical_high.toLocaleString()}/key). Double-check the biggest-ticket items.`,
      band, tier_label: tierLabel,
    };
  }
  if (perKey < band.low) {
    return {
      level: "alert",
      message: `${formatKeyRate(total, keys)} is well below the typical ${tierLabel} floor ($${band.typical_low.toLocaleString()}/key). Many items are probably missing cost data — use "pull from AI" or match against the cost DB.`,
      band, tier_label: tierLabel,
    };
  }
  if (perKey < band.typical_low) {
    return {
      level: "warn",
      message: `${formatKeyRate(total, keys)} is below the typical ${tierLabel} range. Likely some items are uncosted.`,
      band, tier_label: tierLabel,
    };
  }
  return {
    level: "ok",
    message: `${formatKeyRate(total, keys)} is in the typical ${tierLabel} range ($${band.typical_low.toLocaleString()}–$${band.typical_high.toLocaleString()}/key). ✓`,
    band, tier_label: tierLabel,
  };
}


function formatKeyRate(total: number, keys: number): string {
  const perKey = total / keys;
  return `$${round(total).toLocaleString()} total · $${round(perKey).toLocaleString()}/key`;
}

function round(n: number): number {
  if (n < 10_000) return Math.round(n / 100) * 100;
  if (n < 100_000) return Math.round(n / 1_000) * 1_000;
  return Math.round(n / 10_000) * 10_000;
}
