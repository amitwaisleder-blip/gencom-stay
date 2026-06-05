// ============================================================
// Gencom Stay — portfolio config
// ============================================================
// Single source of truth for properties, rates, blackout dates, and
// contacts. Non-developers can hand this file off to an engineer for
// edits; the shape is documented with inline comments and enforced by
// the TypeScript types in ./types.ts.
//
// To add a property: append a new object to `GENCOM_PORTFOLIO` below.
// Every property needs an `id` (url-safe slug, unique) and at minimum a
// `name`, `brand`, `location`, and `contact` / `assetManager`.
// ============================================================

import type { HolidayFlag, Property } from "./types";


// ------------------------------------------------------------
// HSHR LLC 2026 observed holidays — displayed as informational
// "high-demand" warnings when a requester selects one of these dates
// for any property. They are NOT hard blackouts.
// ------------------------------------------------------------
export const HSHR_HOLIDAYS_2026: HolidayFlag[] = [
  { date: "2026-01-01", label: "New Year's Day" },
  { date: "2026-01-02", label: "New Year's (observed)" },
  { date: "2026-01-19", label: "Martin Luther King Jr Day" },
  { date: "2026-02-16", label: "President's Day" },
  { date: "2026-05-25", label: "Memorial Day" },
  { date: "2026-06-19", label: "Juneteenth" },
  { date: "2026-07-03", label: "Independence Day (observed)" },
  { date: "2026-09-07", label: "Labor Day" },
  { date: "2026-11-26", label: "Thanksgiving Day" },
  { date: "2026-11-27", label: "Thanksgiving (day after)" },
  { date: "2026-12-24", label: "Christmas Eve" },
  { date: "2026-12-25", label: "Christmas Day" },
  { date: "2026-12-31", label: "New Year's Eve" },
  { date: "2027-01-01", label: "New Year's Day" },
];


// ------------------------------------------------------------
// Portfolio — placeholder data for 5 properties so the full flow can be
// reviewed end-to-end. Replace with the real list when Ben provides it.
// ------------------------------------------------------------
export const GENCOM_PORTFOLIO: Property[] = [
  {
    id: "rccp-central-park",
    name: "The Ritz-Carlton New York, Central Park",
    brand: "Ritz-Carlton",
    location: "New York, NY",
    tagline: "Central Park's enduring grande dame, reimagined.",
    heroImage: null, // optional URL; falls back to monogram placeholder
    address: "50 Central Park South, New York, NY 10019",
    contact: {
      name: "Lara Fitzpatrick",
      title: "Director of Sales",
      email: "lara.fitzpatrick@ritzcarlton.example",
      phone: "+1 (212) 308-9100",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Deluxe Park View", friendsAndFamilyRate: 495, notes: "King or Queen · 425 sf" },
      { category: "Executive Suite", friendsAndFamilyRate: 795, notes: "Living room + bedroom" },
      { category: "Central Park Suite", friendsAndFamilyRate: 1195, notes: "Park-facing, 1,100 sf" },
    ],
    blackoutRanges: [
      { start: "2026-05-01", end: "2026-05-10", reason: "Frieze Art Fair + Met Gala compression" },
      { start: "2026-09-20", end: "2026-09-27", reason: "UN General Assembly" },
      { start: "2026-12-20", end: "2027-01-02", reason: "Holiday compression" },
    ],
    notes: [
      "Resort fee waived for owner/F&F rates; parking at $85/night valet.",
      "Breakfast not included; La Société open 7–11am daily.",
      "14-day advance notice required; 7 days for suite categories.",
    ],
  },
  {
    id: "rccp-nola",
    name: "The Ritz-Carlton New Orleans",
    brand: "Ritz-Carlton",
    location: "New Orleans, LA",
    tagline: "French Quarter elegance on Canal Street.",
    heroImage: null,
    address: "921 Canal Street, New Orleans, LA 70112",
    contact: {
      name: "Marcus Thibodeaux",
      title: "Front Office Manager",
      email: "marcus.thibodeaux@ritzcarlton.example",
      phone: "+1 (504) 524-1331",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Deluxe King", friendsAndFamilyRate: 229 },
      { category: "Club Level King", friendsAndFamilyRate: 345, notes: "Lounge access incl." },
      { category: "Maison Orleans Suite", friendsAndFamilyRate: 595 },
    ],
    blackoutRanges: [
      { start: "2026-02-13", end: "2026-02-18", reason: "Mardi Gras / Carnival" },
      { start: "2026-04-24", end: "2026-05-03", reason: "Jazz Fest" },
      { start: "2026-11-24", end: "2026-11-29", reason: "Bayou Classic + Thanksgiving" },
    ],
    notes: [
      "Resort fee waived. Valet parking at 50% off ($29/night).",
      "Breakfast included in all owner/F&F rates at Davenport Lounge.",
      "21-day notice required during Jazz Fest window.",
    ],
  },
  {
    id: "mama-shelter-la",
    name: "Mama Shelter Los Angeles",
    brand: "Mama Shelter",
    location: "Los Angeles, CA",
    tagline: "Hollywood irreverence with a rooftop view.",
    heroImage: null,
    address: "6500 Selma Avenue, Los Angeles, CA 90028",
    contact: {
      name: "Sofia Mendez",
      title: "General Manager",
      email: "sofia.mendez@mamashelter.example",
      phone: "+1 (323) 785-6666",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Mama Small", friendsAndFamilyRate: 159 },
      { category: "Mama Medium", friendsAndFamilyRate: 199 },
      { category: "Mama Large", friendsAndFamilyRate: 249, notes: "Corner room + balcony" },
    ],
    blackoutRanges: [
      { start: "2026-03-28", end: "2026-04-05", reason: "GRAMMYs / awards season" },
      { start: "2026-10-22", end: "2026-11-02", reason: "Halloween / Día de los Muertos rooftop events" },
    ],
    notes: [
      "No resort fee. Self-park $28/night.",
      "Rooftop bar & pool open to guests 7am–11pm.",
      "7-day advance notice typical.",
    ],
  },
  {
    id: "sirata-beach",
    name: "Sirata Beach Resort",
    brand: "Independent",
    location: "St. Pete Beach, FL",
    tagline: "Gulf-front family resort with a reinvented heart.",
    heroImage: null,
    address: "5300 Gulf Boulevard, St. Pete Beach, FL 33706",
    contact: {
      name: "Patricia Vaughn",
      title: "Director of Rooms",
      email: "pvaughn@sirata.example",
      phone: "+1 (727) 363-5100",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Run of House", friendsAndFamilyRate: 159 },
      { category: "Gulf View King", friendsAndFamilyRate: 219 },
      { category: "Gulf Front Suite", friendsAndFamilyRate: 329, notes: "Balcony over the sand" },
    ],
    blackoutRanges: [
      { start: "2026-03-07", end: "2026-03-22", reason: "Spring break peak" },
      { start: "2026-07-01", end: "2026-07-06", reason: "4th of July weekend" },
    ],
    notes: [
      "Resort fee waived. Self-park included.",
      "Daily breakfast included at Rum Runners for owner/F&F stays.",
      "14-day notice required in season (Dec–Apr).",
    ],
  },
  {
    id: "midtown4-unit2905",
    name: "Midtown 4 Residences — Unit 2905",
    brand: "Gencom Residences",
    location: "Miami, FL",
    tagline: "Private 2BR residence in Edgewater for team stays.",
    heroImage: null,
    address: "3131 NE 7th Avenue, Miami, FL 33137",
    contact: {
      name: "Residence Concierge",
      title: "Property Manager",
      email: "concierge.midtown4@gencomgrp.example",
      phone: "+1 (305) 555-0199",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Full Unit — 2BR", friendsAndFamilyRate: 0, notes: "Complimentary for Gencom team. 3-night minimum." },
    ],
    blackoutRanges: [
      { start: "2026-02-10", end: "2026-02-13", reason: "Super Bowl / Formula 1 window" },
      { start: "2026-12-01", end: "2026-12-06", reason: "Art Basel" },
    ],
    notes: [
      "Complimentary for Gencom team members; departmental use has priority.",
      "Self-park included in garage; beach chairs and towels provided.",
      "30-day advance notice preferred; concierge holds keys.",
    ],
  },

  // ----------------------------------------------------------
  // Additional Gencom-owned/operated properties. Names, brands,
  // cities, and street addresses are real and verified from public
  // sources. The operational data below — friends-&-family rates,
  // on-property contacts (intentionally fake @*.example emails),
  // blackout ranges, and notes — is PROVISIONAL placeholder data and
  // must be replaced with the figures from the asset-manager source
  // documents before this is shared beyond the team.
  // ----------------------------------------------------------
  {
    id: "rc-bachelor-gulch",
    name: "The Ritz-Carlton Bachelor Gulch",
    brand: "Ritz-Carlton",
    location: "Beaver Creek, CO",
    tagline: "Slopeside Rocky Mountain grandeur in Beaver Creek.",
    heroImage: null,
    address: "0130 Daybreak Ridge, Avon, CO 81620",
    contact: {
      name: "Daniel Mercer",
      title: "Director of Sales",
      email: "daniel.mercer@ritzcarlton.example",
      phone: "+1 (970) 748-6200",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Deluxe Room", friendsAndFamilyRate: 425, notes: "Mountain or valley view" },
      { category: "Junior Suite", friendsAndFamilyRate: 695, notes: "Fireplace + sitting area" },
      { category: "Residential Suite", friendsAndFamilyRate: 1095, notes: "Ski-in/ski-out, 1BR" },
    ],
    blackoutRanges: [
      { start: "2026-12-20", end: "2027-01-03", reason: "Holiday ski week compression" },
      { start: "2026-02-13", end: "2026-02-22", reason: "Presidents' week peak ski" },
      { start: "2026-03-14", end: "2026-03-22", reason: "Spring break peak" },
    ],
    notes: [
      "PLACEHOLDER rates/policies — confirm with asset manager.",
      "Ski valet and slope access included; resort fee waived for owner/F&F.",
      "14-day advance notice; 30 days during holiday ski windows.",
    ],
  },
  {
    id: "rc-philadelphia",
    name: "The Ritz-Carlton Philadelphia",
    brand: "Ritz-Carlton",
    location: "Philadelphia, PA",
    tagline: "Beaux-Arts landmark on Avenue of the Arts.",
    heroImage: null,
    address: "10 Avenue of the Arts, Philadelphia, PA 19102",
    contact: {
      name: "Rebecca Lowe",
      title: "Front Office Manager",
      email: "rebecca.lowe@ritzcarlton.example",
      phone: "+1 (215) 523-8000",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Deluxe King", friendsAndFamilyRate: 239 },
      { category: "Club Level King", friendsAndFamilyRate: 369, notes: "Lounge access incl." },
      { category: "Rotunda Suite", friendsAndFamilyRate: 649 },
    ],
    blackoutRanges: [
      { start: "2026-07-02", end: "2026-07-06", reason: "Independence Day / Wawa Welcome America" },
      { start: "2026-11-25", end: "2026-11-29", reason: "Thanksgiving + parade weekend" },
    ],
    notes: [
      "PLACEHOLDER rates/policies — confirm with asset manager.",
      "Resort fee waived; valet parking at 50% off for owner/F&F.",
      "10-day advance notice typical.",
    ],
  },
  {
    id: "rc-coconut-grove",
    name: "The Ritz-Carlton Coconut Grove, Miami",
    brand: "Ritz-Carlton",
    location: "Miami, FL",
    tagline: "Tropical calm above the Grove.",
    heroImage: null,
    address: "3300 SW 27th Avenue, Miami, FL 33133",
    contact: {
      name: "Carlos Reyes",
      title: "Director of Sales",
      email: "carlos.reyes@ritzcarlton.example",
      phone: "+1 (305) 644-4680",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Deluxe Room", friendsAndFamilyRate: 299 },
      { category: "Junior Suite", friendsAndFamilyRate: 489, notes: "Bay or city view" },
      { category: "Grove Suite", friendsAndFamilyRate: 749 },
    ],
    blackoutRanges: [
      { start: "2026-12-01", end: "2026-12-07", reason: "Art Basel Miami Beach" },
      { start: "2026-02-06", end: "2026-02-09", reason: "Super Bowl / F1 window" },
    ],
    notes: [
      "PLACEHOLDER rates/policies — confirm with asset manager.",
      "Resort fee waived for owner/F&F; valet at $30/night.",
      "14-day advance notice; 30 days during Art Basel.",
    ],
  },
  {
    id: "rc-key-biscayne",
    name: "The Ritz-Carlton Key Biscayne, Miami",
    brand: "Ritz-Carlton",
    location: "Key Biscayne, FL",
    tagline: "Oceanfront island retreat, freshly reimagined.",
    heroImage: null,
    address: "455 Grand Bay Drive, Key Biscayne, FL 33149",
    contact: {
      name: "Olivia Grant",
      title: "Director of Rooms",
      email: "olivia.grant@ritzcarlton.example",
      phone: "+1 (305) 365-4500",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Resort View King", friendsAndFamilyRate: 359 },
      { category: "Ocean View King", friendsAndFamilyRate: 519 },
      { category: "Oceanfront Suite", friendsAndFamilyRate: 895, notes: "Balcony over the Atlantic" },
    ],
    blackoutRanges: [
      { start: "2026-03-21", end: "2026-04-05", reason: "Miami Open + spring break" },
      { start: "2026-12-26", end: "2027-01-02", reason: "Holiday beach compression" },
    ],
    notes: [
      "PLACEHOLDER rates/policies — confirm with asset manager.",
      "Resort fee waived for owner/F&F; beach service included.",
      "21-day advance notice during Miami Open window.",
    ],
  },
  {
    id: "st-regis-chicago",
    name: "The St. Regis Chicago",
    brand: "St. Regis",
    location: "Chicago, IL",
    tagline: "Jeanne Gang's riverfront tower off the Magnificent Mile.",
    heroImage: null,
    address: "401 East Wacker Drive, Chicago, IL 60601",
    contact: {
      name: "Nathan Brooks",
      title: "Director of Sales",
      email: "nathan.brooks@stregis.example",
      phone: "+1 (312) 770-8700",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Deluxe River View", friendsAndFamilyRate: 279 },
      { category: "Astor Suite", friendsAndFamilyRate: 559, notes: "Corner, lake + river views" },
      { category: "Caroline Astor Suite", friendsAndFamilyRate: 899 },
    ],
    blackoutRanges: [
      { start: "2026-05-22", end: "2026-05-26", reason: "Memorial Day / festival season" },
      { start: "2026-09-04", end: "2026-09-07", reason: "Labor Day + jazz festival" },
    ],
    notes: [
      "PLACEHOLDER rates/policies — confirm with asset manager.",
      "Includes St. Regis Butler Service; valet at 50% off for owner/F&F.",
      "10-day advance notice typical.",
    ],
  },
  {
    id: "nekajui-papagayo",
    name: "Nekajui, a Ritz-Carlton Reserve",
    brand: "Ritz-Carlton Reserve",
    location: "Peninsula Papagayo, Costa Rica",
    tagline: "Pacific-coast Reserve hidden in the Guanacaste jungle.",
    heroImage: null,
    address: "Peninsula Papagayo, Guanacaste 50503, Costa Rica",
    contact: {
      name: "Isabela Quirós",
      title: "Reserve Host Manager",
      email: "isabela.quiros@ritzcarltonreserve.example",
      phone: "+506 4080 0000",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Jungle Casita", friendsAndFamilyRate: 895, notes: "Plunge pool + outdoor shower" },
      { category: "Ocean View Casita", friendsAndFamilyRate: 1295 },
      { category: "Reserve Villa — 1BR", friendsAndFamilyRate: 2150, notes: "Private pool, butler" },
    ],
    blackoutRanges: [
      { start: "2026-12-20", end: "2027-01-04", reason: "Holiday high season" },
      { start: "2026-03-28", end: "2026-04-05", reason: "Semana Santa (Holy Week)" },
    ],
    notes: [
      "PLACEHOLDER rates/policies — confirm with asset manager.",
      "All-Reserve experience; daily breakfast and Reserve Host included.",
      "30-day advance notice; 3-night minimum for villas.",
    ],
  },
  {
    id: "thompson-central-park",
    name: "Thompson Central Park New York",
    brand: "Thompson",
    location: "New York, NY",
    tagline: "Design-forward stays steps from Central Park.",
    heroImage: null,
    address: "119 West 56th Street, New York, NY 10019",
    contact: {
      name: "Maya Lindqvist",
      title: "Front Office Manager",
      email: "maya.lindqvist@thompsonhotels.example",
      phone: "+1 (212) 707-8000",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Cozy King", friendsAndFamilyRate: 219 },
      { category: "Deluxe Park View", friendsAndFamilyRate: 349 },
      { category: "Thompson Suite", friendsAndFamilyRate: 595 },
    ],
    blackoutRanges: [
      { start: "2026-09-20", end: "2026-09-27", reason: "UN General Assembly" },
      { start: "2026-11-25", end: "2026-11-29", reason: "Macy's Parade + Thanksgiving" },
      { start: "2026-12-28", end: "2027-01-01", reason: "New Year's compression" },
    ],
    notes: [
      "PLACEHOLDER rates/policies — confirm with asset manager.",
      "No resort fee; breakfast available at the lobby restaurant.",
      "10-day advance notice typical.",
    ],
  },
  {
    id: "intercontinental-nyts",
    name: "InterContinental New York Times Square",
    brand: "InterContinental",
    location: "New York, NY",
    tagline: "Floor-to-ceiling glass over the Theater District.",
    heroImage: null,
    address: "300 West 44th Street, New York, NY 10036",
    contact: {
      name: "Gregory Hahn",
      title: "Director of Sales",
      email: "gregory.hahn@ihg.example",
      phone: "+1 (212) 803-4500",
    },
    assetManager: {
      name: "Ben Dennis",
      email: "bdennis@gencomgrp.com",
    },
    rates: [
      { category: "Classic King", friendsAndFamilyRate: 209 },
      { category: "Premium City View", friendsAndFamilyRate: 309 },
      { category: "Junior Suite", friendsAndFamilyRate: 489 },
    ],
    blackoutRanges: [
      { start: "2026-09-20", end: "2026-09-27", reason: "UN General Assembly" },
      { start: "2026-12-28", end: "2027-01-01", reason: "Times Square New Year's Eve" },
    ],
    notes: [
      "PLACEHOLDER rates/policies — confirm with asset manager.",
      "No resort fee; valet parking available nearby.",
      "7-day advance notice typical.",
    ],
  },
];
