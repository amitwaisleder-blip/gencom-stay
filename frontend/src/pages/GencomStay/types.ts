// Gencom Stay — shared types. Every field that exists in the config
// flows through these definitions.

export type Contact = {
  name: string;
  title?: string;
  email: string;
  phone?: string;
};

export type AssetManager = {
  name: string;
  email: string;
};

export type RoomRate = {
  /** Human-readable category ("Deluxe King", "Ocean Suite"). */
  category: string;
  /** Nightly rate in USD. 0 = complimentary (team residences). */
  friendsAndFamilyRate: number;
  /** Optional per-row footnote ("Lounge access incl.", "Balcony 500 sf"). */
  notes?: string;
};

export type BlackoutRange = {
  /** YYYY-MM-DD inclusive. */
  start: string;
  /** YYYY-MM-DD inclusive. */
  end: string;
  /** Brief reason shown next to the date in the calendar list. */
  reason?: string;
};

export type HolidayFlag = {
  /** YYYY-MM-DD. */
  date: string;
  /** "Christmas Eve", "MLK Jr. Day", etc. */
  label: string;
};

export type Property = {
  /** URL-safe slug, unique across the portfolio. */
  id: string;
  /** Full official property name. Rendered in the serif display face. */
  name: string;
  /** Brand flag — "Ritz-Carlton", "Four Seasons", "Independent", etc. */
  brand: string;
  /** City, State (or City, Country). */
  location: string;
  /** One-line descriptor shown under the card title. */
  tagline: string;
  /** Optional hero image URL. If null, a monogram placeholder renders. */
  heroImage: string | null;
  /** Full street address for the detail page. */
  address: string;
  /** Property-side contact — request emails route TO this person. */
  contact: Contact;
  /** Gencom-side asset manager — request emails route CC to this person. */
  assetManager: AssetManager;
  /** Owner / friends-and-family rates by room category. */
  rates: RoomRate[];
  /** Blocked-out date ranges (compression periods, citywide events, etc). */
  blackoutRanges: BlackoutRange[];
  /** Bulleted property notes shown on the detail page. */
  notes: string[];
  /** Tombstone flag. Seed properties can't be hard-deleted (they're in
   *  code), so deletions persist a backend row with hidden=true and the
   *  portfolio merge filters them out. Backend-only properties are
   *  hard-deleted instead. */
  hidden?: boolean;
};

export type RequestPurpose =
  | "personal"
  | "family"
  | "business_adjacent"
  | "site_visit"
  | "other";
