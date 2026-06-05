// Lunch Menu — backend API wrappers.

export type LunchMenuRow = {
  id: string;
  date: string;     // YYYY-MM-DD
  items: string[];
  source: string;
  notes: string | null;
};

export type LunchMetrics = {
  menu_count: number;
  item_count: number;
  unique_items: number;
  date_range: { start: string; end: string } | null;
  top_items: { name: string; count: number }[];
  by_day_of_week: {
    day: string;
    day_index: number;
    menus_served: number;
    top_items: { name: string; count: number }[];
  }[];
};

export type LunchItem = { key: string; name: string; count: number };

export type LunchPrediction = {
  generated_at: string;
  history_menus: number;
  target_month: string;              // e.g. "2026-05"
  target_month_label: string;        // e.g. "May 2026"
  target_month_first_day: string;    // YYYY-MM-DD
  target_month_last_day: string;     // YYYY-MM-DD
  projections: {
    date: string;
    day_of_week: string;             // "Mon", "Tue", …
    confidence: "low" | "medium" | "high";
    weekday_menu_count: number;      // how many historical menus landed on this weekday
    predicted_items: {
      name: string;
      /** 0..1 — combined predictability for this specific date.
       *  Computed server-side as base_weekday_frequency × recency_weight
       *  × gap_match. The bar/percentage in the UI reflects this, not
       *  raw frequency. */
      score: number;
      served_on_weekday: number;
      weekday_total: number;
      /** Days since the dish was last seen anywhere on the menu (any
       *  weekday). Drives the recency penalty in the score. */
      days_since_any?: number;
      /** Weeks since the dish was last seen on this same weekday.
       *  Null when the dish has never been served on this weekday. */
      weeks_since_same_dow?: number | null;
      /** Mean gap (in weeks) between this dish's appearances on this
       *  weekday. Null when there are fewer than 2 same-weekday samples
       *  to estimate a gap from. */
      typical_gap_weeks?: number | null;
    }[];
  }[];
};

/**
 * Spec'd seven-factor forecast (one entry per business day in the
 * window). Each prediction carries the winning dish, its confidence
 * (total_score × 100), 3–5 plain-language reasons, the per-factor
 * breakdown that powers the "score receipt" UI, and three runners-up.
 *
 * Until a real dish catalog exists, `protein` and `cuisine` come from a
 * keyword classifier on the dish name and `complexity` / `avg_rating`
 * are neutral defaults — the factor breakdown still reflects this so
 * the UI can fade those rows or hide them when they're flat.
 */
export type ForecastDish = {
  id: string;
  name: string;
  protein: string | null;
  cuisine: string | null;
  complexity: number;
  avg_rating: number;
  times_served_ytd: number;
  last_served_date: string | null;
  seasonal_affinity: { winter: number; spring: number; summer: number; fall: number };
  /** Keys are stringified weekday numbers, "1"..."5" (Mon..Fri). */
  dow_affinity: Record<string, number>;
};

export type ForecastFactor = {
  /** "recency" | "rating" | "season" | "dow" | "rotation" | "complexity" | "novelty" */
  factor: string;
  raw_score: number;
  weight: number;
  /** raw_score × weight × 100 — the per-factor contribution in points. */
  contribution_pts: number;
};

export type ForecastDay = {
  date: string;             // YYYY-MM-DD
  dow: number;              // 1=Mon … 5=Fri
  day_of_week: string;      // "Monday", "Tuesday", …
  predicted_dish: ForecastDish | null;   // null when catalog is empty
  confidence: number;       // 0–100, total_score × 100 (always 100 when scheduled)
  reasons: string[];        // 3–5 plain-language bullets
  factor_breakdown: ForecastFactor[];    // empty when scheduled
  runners_up: { dish: ForecastDish; confidence: number }[];   // empty when scheduled
  /** True when the kitchen has already saved a menu for this date — the
   *  predictor surfaces the saved dish verbatim instead of guessing. */
  scheduled?: boolean;
};

export type Forecast = {
  generated_at: string;
  today: string;
  days_ahead: number;
  history_menus: number;
  catalog_size: number;
  predictions: ForecastDay[];
};

export type LunchPredictionExplanation = {
  date: string;
  day_of_week: string;
  weekday_menu_count: number;
  candidates: string[];
  reason: string;
};

export async function listMenus(start?: string, end?: string): Promise<LunchMenuRow[]> {
  const q = new URLSearchParams();
  if (start) q.set("start", start);
  if (end) q.set("end", end);
  const r = await fetch(`/api/lunch-menu/menus${q.toString() ? `?${q}` : ""}`);
  if (!r.ok) return [];
  return (await r.json()) as LunchMenuRow[];
}

export async function upsertMenu(date: string, items: string[], notes?: string, source = "manual"): Promise<LunchMenuRow> {
  const r = await fetch(`/api/lunch-menu/menus/${encodeURIComponent(date)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, items, source, notes: notes ?? null }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as LunchMenuRow;
}

export async function deleteMenu(date: string): Promise<void> {
  await fetch(`/api/lunch-menu/menus/${encodeURIComponent(date)}`, { method: "DELETE" });
}

export async function bulkUpsert(menus: { date: string; items: string[]; notes?: string | null; source?: string }[]): Promise<{ count: number }> {
  const r = await fetch("/api/lunch-menu/menus/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menus }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as { count: number };
}

/**
 * PDF menu import. Pass a single File for backward compatibility, or a
 * list of Files to extract menus from several PDFs in one request.
 */
export async function importPdf(
  filesOrFile: File | File[],
): Promise<{ date: string; items: string[] }[]> {
  const fd = new FormData();
  const files = Array.isArray(filesOrFile) ? filesOrFile : [filesOrFile];
  for (const f of files) fd.append("files", f);
  const r = await fetch("/api/lunch-menu/import-pdf", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j = await r.json();
  return (j.menus ?? []) as { date: string; items: string[] }[];
}

/**
 * Outlook email import. Pass one or more .eml / .msg files in
 * `emailFiles`, and/or paste the body text and supply any loose
 * attachments. Every email's in-body attachments are auto-extracted
 * server-side and passed to Claude alongside the bodies, so forwarded
 * weekly menus with caterer PDFs or XLSX schedules land as drafts in
 * one shot.
 */
export async function importEmail(args: {
  emailFiles?: File[];
  bodyText?: string;
  attachments?: File[];
}): Promise<{ date: string; items: string[] }[]> {
  const fd = new FormData();
  for (const f of (args.emailFiles ?? [])) fd.append("email_files", f);
  if (args.bodyText && args.bodyText.trim()) fd.append("body_text", args.bodyText);
  for (const a of (args.attachments ?? [])) fd.append("attachments", a);
  const r = await fetch("/api/lunch-menu/import-email", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j = await r.json();
  return (j.menus ?? []) as { date: string; items: string[] }[];
}

/** Drop every menu + every favorite. Destructive, confirm before calling. */
export async function wipeAllMenus(): Promise<{ menus_deleted: number; favorites_deleted: number } | null> {
  const r = await fetch("/api/lunch-menu/menus", { method: "DELETE" });
  if (!r.ok) return null;
  return await r.json();
}

export async function getMetrics(): Promise<LunchMetrics> {
  const r = await fetch("/api/lunch-menu/metrics");
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as LunchMetrics;
}

export async function listItems(): Promise<LunchItem[]> {
  const r = await fetch("/api/lunch-menu/items");
  if (!r.ok) return [];
  return (await r.json()) as LunchItem[];
}

export type FavoriteEntry = { item_key: string; rank: number | null };

export async function listFavorites(): Promise<FavoriteEntry[]> {
  const r = await fetch("/api/lunch-menu/favorites");
  if (!r.ok) return [];
  const j = await r.json();
  return j as FavoriteEntry[];
}

export const FAVORITES_LIMIT = 10;

export async function toggleFavorite(itemKey: string): Promise<"added" | "removed" | "full"> {
  const r = await fetch("/api/lunch-menu/favorites/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_key: itemKey }),
  });
  if (r.status === 409) return "full";
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  return j.status as "added" | "removed";
}

export async function reorderFavorite(itemKey: string, direction: "up" | "down"): Promise<void> {
  const r = await fetch("/api/lunch-menu/favorites/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_key: itemKey, direction }),
  });
  if (!r.ok) throw new Error(await r.text());
}

/** Replace the user's entire top-10 with this ranked list. Used by the
 *  tournament picker to commit the final standings in one shot. */
export async function setFavoriteRanks(itemKeys: string[]): Promise<void> {
  const r = await fetch("/api/lunch-menu/favorites/set-ranks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_keys: itemKeys }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export type CompanyFavorite = {
  item_key: string;
  name: string;
  score: number;
  marks: number;
};

export async function companyFavorites(): Promise<{ items: CompanyFavorite[]; user_count: number }> {
  const r = await fetch("/api/lunch-menu/favorites/company");
  if (!r.ok) return { items: [], user_count: 0 };
  return (await r.json()) as { items: CompanyFavorite[]; user_count: number };
}

/**
 * Fetch the month-long prediction. Pass `month` as YYYY-MM to override;
 * defaults to the NEXT calendar month when omitted.
 */
export async function getPrediction(month?: string): Promise<LunchPrediction> {
  const q = month ? `?month=${encodeURIComponent(month)}` : "";
  const r = await fetch(`/api/lunch-menu/prediction${q}`);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as LunchPrediction;
}

/**
 * Spec'd seven-factor forecast for the next N business days. Returns
 * the winning dish per day along with reasons + per-factor breakdown.
 * `startDate` defaults to today (UTC); `daysAhead` is clamped 1..30 by
 * the server.
 */
export async function getForecast(args?: {
  daysAhead?: number;
  startDate?: string;
}): Promise<Forecast> {
  const q = new URLSearchParams();
  if (args?.daysAhead != null) q.set("days_ahead", String(args.daysAhead));
  if (args?.startDate) q.set("start_date", args.startDate);
  const r = await fetch(`/api/lunch-menu/forecast${q.toString() ? `?${q}` : ""}`);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as Forecast;
}

/**
 * Ask Claude for a 2-3 sentence narrative of why a specific day's
 * predicted items are the most likely picks. `items` is optional — when
 * omitted the server uses the current top-k for that weekday.
 */
export async function explainPrediction(args: {
  date: string;
  items?: string[];
}): Promise<LunchPredictionExplanation> {
  const r = await fetch("/api/lunch-menu/prediction/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as LunchPredictionExplanation;
}

