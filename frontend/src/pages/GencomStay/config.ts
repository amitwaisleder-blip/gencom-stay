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
];
