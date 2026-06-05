// GenCal — category definitions, labels, and color treatments. Colors
// are chosen from the Gencom Stay luxury palette (warm off-white, deep
// charcoal, muted gold) and extended with the category tones specified
// in the GenCal brief: terracotta, gold, slate, bronze, rose, slate.

export type GenCalCategory =
  | "holiday"
  | "party"
  | "board"
  | "property"
  | "birthday"
  | "anniversary"
  | "general";

export type CategoryStyle = {
  key: GenCalCategory;
  label: string;
  blurb: string;
  /** Background fill on event chips. */
  bg: string;
  /** Text color on the fill — pre-picked for WCAG contrast. */
  fg: string;
  /** Thin left border accent used in agenda rows. */
  accent: string;
};

// "General" and "board" share the slate family but are visually separable
// via a slightly cooler tone for board — subtle but intentional.
export const CATEGORY_STYLES: Record<GenCalCategory, CategoryStyle> = {
  holiday: {
    key: "holiday", label: "Holidays", blurb: "Office closed",
    bg: "#c56b50", fg: "#ffffff", accent: "#a05239",
  },
  party: {
    key: "party", label: "Parties & social", blurb: "Company gatherings",
    bg: "#b89555", fg: "#ffffff", accent: "#8c6d34",
  },
  board: {
    key: "board", label: "Board / IC", blurb: "Quarterly meetings",
    bg: "#78757d", fg: "#ffffff", accent: "#525055",
  },
  property: {
    key: "property", label: "Property milestones", blurb: "Openings, renovations, anniversaries",
    bg: "#a67c52", fg: "#ffffff", accent: "#7a5a3a",
  },
  birthday: {
    key: "birthday", label: "Birthdays", blurb: "Team recognition",
    bg: "#c89499", fg: "#57262a", accent: "#9a6a6d",
  },
  anniversary: {
    key: "anniversary", label: "Work anniversaries", blurb: "Tenure recognition",
    bg: "#e3c3c7", fg: "#57262a", accent: "#b18589",
  },
  general: {
    key: "general", label: "General events", blurb: "All-hands, training, offsites",
    bg: "#5b6b7d", fg: "#ffffff", accent: "#3d4754",
  },
};

export const CATEGORY_ORDER: GenCalCategory[] = [
  "holiday", "party", "board", "property", "birthday", "anniversary", "general",
];
