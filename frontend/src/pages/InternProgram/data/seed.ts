// Seed data for the demo. One active intern, one completed intern,
// 7 full-timers, 4 weeks of half-day schedule blocks across 3 depts.
// Phase 2-4 records are seeded too so feature-complete portfolios and
// kudos surfaces aren't empty when those phases ship.

import { nanoid } from "nanoid";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";

import type {
  CoffeeChatRequest, Deliverable, FullTimer, Intern, Kudos, LearningGoal,
  ManagerFeedback, ScheduleBlock, ShadowDayRequest, SkillEntry, SkillTag,
  ReturnOfferEntry,
} from "./types";
import { SEED_SKILL_TAGS } from "./vocabularies";

// ----- People (full-timers) -----
// Real Gencom full-timers spread across the eight departments. The
// `Department` keys map to the labels in vocabularies.ts (e.g. key
// `engineering` → "Design + Construction"). isMentorAvailable is true
// for everyone so the mentor picker can offer the full roster; the
// user can flip flags later via Admin if needed.
type FtSeed = { name: string; role: string; department: FullTimer["department"] };

const ROSTER: FtSeed[] = [
  // Design + Construction
  { name: "Lynn Miranda",            role: "Design + Construction",       department: "engineering" },
  { name: "Adam Blaire",             role: "Design + Construction",       department: "engineering" },
  { name: "Donald McGregor",         role: "Design + Construction",       department: "engineering" },
  { name: "Eduardo Cosio",           role: "Design + Construction",       department: "engineering" },
  { name: "Jonathan Castrillon",     role: "Design + Construction",       department: "engineering" },
  // Capital Markets
  { name: "Karim Alibhai",           role: "Capital Markets",              department: "data" },
  { name: "Farhan Alibhai",          role: "Capital Markets",              department: "data" },
  { name: "Ben Dennis",              role: "Capital Markets",              department: "data" },
  { name: "Theo Poncon",             role: "Capital Markets",              department: "data" },
  // Legal
  { name: "Julie Levitt",            role: "Legal",                        department: "marketing" },
  { name: "Margaret Nishimoto",      role: "Legal",                        department: "marketing" },
  { name: "Lidia Barbon",            role: "Legal",                        department: "marketing" },
  // Acquisitions
  { name: "Alessandro Colantonio",   role: "Acquisitions",                 department: "product" },
  { name: "Jake Pagano",             role: "Acquisitions",                 department: "product" },
  { name: "Andres Alfonso",          role: "Acquisitions",                 department: "product" },
  { name: "Laurens Fuchs",           role: "Acquisitions",                 department: "product" },
  { name: "Tyler Gibbs",             role: "Acquisitions",                 department: "product" },
  // Finance
  { name: "Ana Lopez",               role: "Finance",                      department: "finance" },
  { name: "Cibel Menendez",          role: "Finance",                      department: "finance" },
  { name: "Cristina Palacios",       role: "Finance",                      department: "finance" },
  { name: "Fernando Tavara",         role: "Finance",                      department: "finance" },
  { name: "Maria Hernandez",         role: "Finance",                      department: "finance" },
  { name: "Mercedes Castillo",       role: "Finance",                      department: "finance" },
  { name: "Karina Valderrama",       role: "Finance",                      department: "finance" },
  // Accounting
  { name: "Blythe N. Pierre-Louis",  role: "Accounting",                   department: "operations" },
  { name: "Gary Lake",               role: "Accounting",                   department: "operations" },
  { name: "Gregory Nicolay",         role: "Accounting",                   department: "operations" },
  { name: "Lauren Baldaccini",       role: "Accounting",                   department: "operations" },
  { name: "Lisette Lowen",           role: "Accounting",                   department: "operations" },
  { name: "Madison Stern",           role: "Accounting",                   department: "operations" },
  { name: "Margaux Mielcarek",       role: "Accounting",                   department: "operations" },
  { name: "Noria Rubio",             role: "Accounting",                   department: "operations" },
  // Interior Design
  { name: "Ignasi Puig",             role: "Interior Design",              department: "design" },
  { name: "Jesus Pacanins",          role: "Interior Design",              department: "design" },
  { name: "Kenda Bailey",            role: "Interior Design",              department: "design" },
  { name: "Nicolas Fernandez",       role: "Interior Design",              department: "design" },
  { name: "Peter Trujillo",          role: "Interior Design",              department: "design" },
  // Tax
  { name: "Shaun Johnston",          role: "Tax",                          department: "tax" },
  { name: "Steven Pita",             role: "Tax",                          department: "tax" },
];

function _ftId(name: string): string {
  return "ft-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const FULL_TIMERS: FullTimer[] = ROSTER.map((p) => ({
  id: _ftId(p.name),
  name: p.name,
  role: p.role,
  department: p.department,
  email: p.name.split(/\s+/).slice(0, 2).join(".").toLowerCase().replace(/[^a-z.]/g, "") + "@gencomgrp.com",
  isManager: false,
  isMentorAvailable: true,
  coffeeChatOptIn: false,
}));

// ----- Skill tags (controlled vocab + one already-requested-but-unapproved) -----
const SKILL_TAGS: SkillTag[] = [
  ...SEED_SKILL_TAGS.map((t) => ({ ...t, approved: true })),
  // A pending tag from the active intern, demonstrating the "request new tag" loop.
  { id: "tag-rust", label: "Rust", group: "engineering", approved: false },
];

// ----- Active intern + their skills -----
const ACTIVE_INTERN_ID = "intern-mira";

const ACTIVE_INTERN: Intern = {
  id: ACTIVE_INTERN_ID,
  name: "Mira Anand",
  photoUrl: "/avatars/mira.svg",
  school: "Carnegie Mellon University",
  programStart: "2026-04-06",
  programEnd: "2026-08-14",
  status: "active",
  bio: "CS senior interested in developer tooling and small, well-built products. " +
       "Spent last summer at a fintech building internal dashboards. Looking to spend this " +
       "internship working across engineering, product, and data so I can decide which side I lean toward after graduation.",
  resume: {
    education: [
      {
        id: nanoid(8),
        school: "Carnegie Mellon University",
        degree: "B.S.",
        field: "Computer Science",
        startYear: 2022,
        endYear: 2026,
        gpa: "3.84",
        honors: "Dean's List 2023, 2024",
      },
    ],
    experience: [
      {
        id: nanoid(8),
        company: "Bridgetower Capital",
        role: "Software engineering intern",
        startDate: "2025-05",
        endDate: "2025-08",
        description: "Built internal dashboards on a small four-person team. Owned a portfolio-snapshot tool from spec through ship; moved adoption from 0 to ~40 weekly users.",
      },
      {
        id: nanoid(8),
        company: "CMU School of Computer Science",
        role: "Teaching assistant — 15-122",
        startDate: "2024-08",
        endDate: "2025-05",
        description: "TA for the second-semester programming course. Held weekly office hours and graded ~35 students per semester.",
      },
    ],
    projects: [
      {
        id: nanoid(8),
        name: "tdr — terminal dashboard runtime",
        description: "Open-source TUI framework for building observable dashboards from a config file. ~600 GitHub stars.",
        link: "https://github.com/example/tdr",
        technologies: ["Go", "TUI", "Open source"],
      },
      {
        id: nanoid(8),
        name: "Habit graph",
        description: "Personal site that turns plain-text habit logs into year-on-year heatmaps. Used by ~80 of my friends and classmates.",
        link: "https://habit.example.com",
        technologies: ["TypeScript", "Next.js", "D3"],
      },
    ],
    links: [
      { id: nanoid(8), label: "GitHub",   url: "https://github.com/mira-anand" },
      { id: nanoid(8), label: "LinkedIn", url: "https://linkedin.com/in/mira-anand" },
      { id: nanoid(8), label: "Portfolio", url: "https://mira.example.com" },
    ],
  },
  mentorId: "ft-karim-alibhai",
};

const ACTIVE_INTERN_SKILLS: SkillEntry[] = [
  // Current — what she comes in with
  { id: nanoid(8), skillTagId: "tag-typescript", proficiency: "strong",   category: "current" },
  { id: nanoid(8), skillTagId: "tag-react",      proficiency: "strong",   category: "current" },
  { id: nanoid(8), skillTagId: "tag-python",     proficiency: "working",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-sql",        proficiency: "working",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-go",         proficiency: "working",  category: "current",
    note: "Built a TUI framework in Go last year." },
  { id: nanoid(8), skillTagId: "tag-figma",      proficiency: "beginner", category: "current" },
  // Developing — what she wants to grow this internship
  { id: nanoid(8), skillTagId: "tag-aws",        proficiency: "beginner", category: "developing" },
  { id: nanoid(8), skillTagId: "tag-prd",        proficiency: "beginner", category: "developing",
    note: "Want to write a real spec end-to-end." },
  { id: nanoid(8), skillTagId: "tag-stakeholder", proficiency: "beginner", category: "developing" },
  { id: nanoid(8), skillTagId: "tag-rust",       proficiency: "beginner", category: "developing",
    note: "Pending tag approval." },
];

// ----- Schedule blocks for the active intern (4 weeks, 3 depts) -----
// Mira's schedule is built relative to "today" so the demo always has
// "this week" and "next week" populated. We anchor at the Monday of the
// current week and lay out blocks from week -1 through week +2.
function buildActiveSchedule(): ScheduleBlock[] {
  // Default to Mon = start of week. date-fns weekStartsOn=1.
  const todayMon = startOfWeek(new Date(), { weekStartsOn: 1 });
  const blocks: ScheduleBlock[] = [];

  // Pattern: weeks 1-2 mostly engineering, week 3 product-heavy with a
  // design Friday, week 4 data + product. Realistic-ish for a CS intern
  // doing a tour.
  const weekPlans: { offset: number; days: { day: 0|1|2|3|4; am?: BlockSpec; pm?: BlockSpec }[] }[] = [
    {
      offset: -1,
      days: [
        { day: 0, am: eng("Foundations"), pm: eng("Foundations") },
        { day: 1, am: eng("Foundations"), pm: eng("Foundations") },
        { day: 2, am: eng("Foundations"), pm: eng("Foundations") },
        { day: 3, am: eng("Foundations"), pm: prod("Onboarding shadow") },
        { day: 4, am: eng("Foundations"), pm: ops("Operating cadence overview") },
      ],
    },
    {
      offset: 0,
      days: [
        { day: 0, am: eng("Internal tooling sprint"), pm: eng("Internal tooling sprint") },
        { day: 1, am: eng("Internal tooling sprint"), pm: eng("Internal tooling sprint") },
        { day: 2, am: eng("Internal tooling sprint"), pm: data("Reporting deep-dive") },
        { day: 3, am: data("Reporting deep-dive"), pm: data("Reporting deep-dive") },
        { day: 4, am: eng("Internal tooling sprint"), pm: eng("Internal tooling sprint") },
      ],
    },
    {
      offset: 1,
      days: [
        { day: 0, am: prod("Spec writing rotation"), pm: prod("Spec writing rotation") },
        { day: 1, am: prod("Spec writing rotation"), pm: prod("Spec writing rotation") },
        { day: 2, am: prod("Spec writing rotation"), pm: design("Design review tag-along") },
        { day: 3, am: prod("Spec writing rotation"), pm: prod("Spec writing rotation") },
        { day: 4, am: design("Design review tag-along"), pm: design("Design review tag-along") },
      ],
    },
    {
      offset: 2,
      days: [
        { day: 0, am: data("Pricing model exploration"), pm: data("Pricing model exploration") },
        { day: 1, am: data("Pricing model exploration"), pm: prod("Pricing PRD draft") },
        { day: 2, am: prod("Pricing PRD draft"),         pm: prod("Pricing PRD draft") },
        { day: 3, am: data("Pricing model exploration"), pm: data("Pricing model exploration") },
        { day: 4, am: prod("Pricing PRD draft"),         pm: prod("Pricing PRD draft") },
      ],
    },
  ];

  for (const wp of weekPlans) {
    const monday = addWeeks(todayMon, wp.offset);
    for (const d of wp.days) {
      const date = format(addDays(monday, d.day), "yyyy-MM-dd");
      if (d.am) blocks.push(toBlock(date, "AM", d.am));
      if (d.pm) blocks.push(toBlock(date, "PM", d.pm));
    }
  }

  // One proposed change — Mira asks to swap a Friday afternoon to design
  // shadowing in week +1. Demonstrates the propose flow without breaking
  // the underlying schedule.
  const friProposal = blocks.find(
    (b) => b.date === format(addDays(addWeeks(todayMon, 1), 4), "yyyy-MM-dd") && b.half === "AM",
  );
  if (friProposal) {
    blocks.push({
      ...friProposal,
      id: nanoid(8),
      projectName: "Brand refresh shadowing",
      department: "design",
      managerId: "ft-ignasi-puig",
      notes: "Proposed swap: I'd love to sit in on the brand-refresh review on Friday morning if there's room.",
      status: "proposed",
      proposedBy: "intern",
    });
  }

  return blocks;
}

type BlockSpec = Omit<ScheduleBlock, "id" | "internId" | "date" | "half" | "status">;
const eng = (project: string): BlockSpec => ({
  projectName: project, department: "engineering", managerId: "ft-lynn-miranda",
});
const prod = (project: string): BlockSpec => ({
  projectName: project, department: "product", managerId: "ft-alessandro-colantonio",
});
const design = (project: string): BlockSpec => ({
  projectName: project, department: "design", managerId: "ft-ignasi-puig",
});
const data = (project: string): BlockSpec => ({
  projectName: project, department: "data", managerId: "ft-karim-alibhai",
});
const ops = (project: string): BlockSpec => ({
  projectName: project, department: "operations", managerId: "ft-blythe-n-pierre-louis",
});

const toBlock = (
  date: string, half: "AM" | "PM", spec: BlockSpec, internId: string = ACTIVE_INTERN_ID,
): ScheduleBlock => ({
  id: nanoid(8),
  internId,
  date,
  half,
  status: "confirmed",
  ...spec,
});

/** Generic schedule builder. `weekPlans` is the same shape used for
 *  Mira's seed; pass the intern's id and a tour pattern and it lays
 *  out half-day blocks anchored at "this week's Monday." */
function buildSchedule(
  internId: string,
  weekPlans: { offset: number; days: { day: 0|1|2|3|4; am?: BlockSpec; pm?: BlockSpec }[] }[],
): ScheduleBlock[] {
  const todayMon = startOfWeek(new Date(), { weekStartsOn: 1 });
  const blocks: ScheduleBlock[] = [];
  for (const wp of weekPlans) {
    const monday = addWeeks(todayMon, wp.offset);
    for (const d of wp.days) {
      const date = format(addDays(monday, d.day), "yyyy-MM-dd");
      if (d.am) blocks.push(toBlock(date, "AM", d.am, internId));
      if (d.pm) blocks.push(toBlock(date, "PM", d.pm, internId));
    }
  }
  return blocks;
}

// ----- Past intern (for the portfolio surface in Phase 4) -----
const PAST_INTERN_ID = "intern-theo";
const PAST_INTERN: Intern = {
  id: PAST_INTERN_ID,
  name: "Theo Nakamura",
  photoUrl: "/avatars/theo.svg",
  school: "University of Michigan",
  programStart: "2025-05-19",
  programEnd: "2025-08-22",
  status: "completed",
  bio: "Computer engineering grad with a strong systems bent. Spent the summer rotating through " +
       "data and engineering — shipped a billing-anomaly detector that's still in production.",
  resume: {
    education: [{
      id: nanoid(8), school: "University of Michigan", degree: "B.S.", field: "Computer engineering",
      startYear: 2021, endYear: 2025, gpa: "3.71",
    }],
    experience: [{
      id: nanoid(8), company: "Acorn Mobility", role: "Engineering intern",
      startDate: "2024-05", endDate: "2024-08",
      description: "Built telemetry pipelines for an electric-scooter fleet.",
    }],
    projects: [{
      id: nanoid(8), name: "Anomaly detector",
      description: "Production billing-anomaly detector deployed during my internship.",
      technologies: ["Python", "BigQuery"],
    }],
    links: [
      { id: nanoid(8), label: "GitHub", url: "https://github.com/theo-n" },
    ],
  },
};
const PAST_INTERN_SKILLS: SkillEntry[] = [
  { id: nanoid(8), skillTagId: "tag-python", proficiency: "strong",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-sql",    proficiency: "strong",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-aws",    proficiency: "working", category: "current" },
  { id: nanoid(8), skillTagId: "tag-stats",  proficiency: "working", category: "current" },
];

// ----- Phase 2-4 records (seeded for later phases; unused in Phase 1 UI) -----
const DELIVERABLES: Deliverable[] = [
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, weekOf: "2026-04-06",
    title: "Repo onboarding doc", description: "Wrote a 6-page onboarding doc for the internal-tools repo. Now the canonical first-week reading.",
    department: "engineering", projectName: "Foundations" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, weekOf: "2026-04-13",
    title: "Reporting dashboard prototype", description: "Click-through prototype of a unified reporting view. Shared in Friday demo.",
    link: "https://figma.com/example", department: "product", projectName: "Onboarding shadow" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, weekOf: "2026-04-13",
    title: "Pricing data exploration notebook", description: "Notebook digging into 18 months of conversion-by-segment data. Found two segments with 4× the median deal size.",
    department: "data", projectName: "Reporting deep-dive" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, weekOf: "2026-04-20",
    title: "PRD: pricing tier consolidation", description: "First-draft PRD for collapsing four pricing tiers into two. Reviewed by David, in product backlog.",
    department: "product", projectName: "Spec writing rotation" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, weekOf: "2026-04-20",
    title: "Internal CLI for ad-hoc queries", description: "Small Go CLI wrapping our most-asked SQL questions. Saves the data team ~30 min/day.",
    department: "engineering", projectName: "Internal tooling sprint" },
];

const LEARNING_GOALS: LearningGoal[] = [
  { id: nanoid(8), internId: ACTIVE_INTERN_ID,
    title: "Write a real PRD end-to-end",
    description: "Draft, review, and ship one product requirements doc that influences a real engineering build.",
    status: "on-track",
    checkIns: [
      { id: nanoid(8), date: "2026-04-12", note: "First spec draft started; David sketched the outline with me.", author: "Mira Anand" },
      { id: nanoid(8), date: "2026-04-19", note: "Got useful feedback from product review. Revising for clarity.", author: "Mira Anand" },
    ] },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID,
    title: "Get basic AWS production fluency",
    description: "Be able to deploy a small service end-to-end without hand-holding by week 8.",
    status: "on-track", checkIns: [] },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID,
    title: "Lead one cross-team demo",
    description: "Run an end-of-rotation demo with engineering, product, and design in the room.",
    status: "at-risk",
    checkIns: [{ id: nanoid(8), date: "2026-04-22", note: "Schedule conflict pushed the design portion. Need to find a new slot.", author: "Mira Anand" }] },
];

const FEEDBACK: ManagerFeedback[] = [
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, managerId: "ft-lynn-miranda",
    weekOf: "2026-04-06", rating: 5,
    note: "Picked up the codebase faster than any intern I've had — onboarding doc is genuinely useful." },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, managerId: "ft-alessandro-colantonio",
    weekOf: "2026-04-13", rating: 4,
    note: "Strong analytical chops. Push her on stakeholder communication; instinct is to over-prepare and under-share." },
];

const KUDOS: Kudos[] = [
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, fromName: "Jonah Reyes", fromRole: "Frontend engineer",
    message: "Pair-programming with Mira this week was a treat. Asked the right questions and didn't pretend to know things she didn't.",
    createdAt: "2026-04-15T16:20:00Z" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, fromName: "Marcus Chen", fromRole: "Staff data scientist",
    message: "The pricing notebook surfaced two segments we'd genuinely missed. Above-and-beyond on a first analytics task.",
    createdAt: "2026-04-18T14:02:00Z" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, fromName: "David Okafor", fromRole: "Senior product manager",
    message: "PRD draft is way ahead of where I'd expect at week three. Good clear thinking.",
    createdAt: "2026-04-21T19:45:00Z" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, fromName: "Sara Hoffmann", fromRole: "Operations lead",
    message: "Quietly fixed a calendar mess in our ops cadence doc. Thank you, Mira.",
    createdAt: "2026-04-23T11:10:00Z" },
];

const RETURN_OFFERS: ReturnOfferEntry[] = [
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, managerId: "ft-lynn-miranda",
    projectName: "Internal tooling sprint", recommendation: "would-hire",
    note: "Strong engineering instincts. Would absolutely re-hire.",
    createdAt: "2026-04-19T18:00:00Z" },
];

// ----- Shadow day requests (active intern explores design + ops) -----
const SHADOW_DAYS: ShadowDayRequest[] = [
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, targetDepartment: "design",
    requestedDate: "2026-05-08", half: "PM",
    reason: "Sit in on the brand-refresh review — curious how the design team runs critique sessions.",
    status: "approved", approvedBy: "ft-ignasi-puig",
    decisionNote: "Of course! See you Friday afternoon.",
    createdAt: "2026-04-20T15:30:00Z" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, targetDepartment: "marketing",
    requestedDate: "2026-05-15", half: "AM",
    reason: "Want to understand how growth experiments get scoped end-to-end.",
    status: "pending",
    createdAt: "2026-04-23T17:10:00Z" },
];

// ----- Past intern back-fill: deliverables, goals, kudos, return-offer -----
const PAST_DELIVERABLES: Deliverable[] = [
  { id: nanoid(8), internId: PAST_INTERN_ID, weekOf: "2025-06-02",
    title: "Telemetry pipeline draft", description: "First-cut pipeline ingesting scooter telemetry into BigQuery; later became the foundation for the anomaly detector.",
    department: "engineering", projectName: "Telemetry foundations" },
  { id: nanoid(8), internId: PAST_INTERN_ID, weekOf: "2025-06-30",
    title: "Anomaly detector v1", description: "First production version of the billing-anomaly detector. Caught 3 issues in the first week.",
    department: "data", projectName: "Anomaly detection" },
  { id: nanoid(8), internId: PAST_INTERN_ID, weekOf: "2025-07-21",
    title: "Anomaly detector v2 + alerting", description: "Added Slack alerting and a daily digest. Reduced false positives 60% by tuning the residual threshold.",
    department: "data", projectName: "Anomaly detection" },
  { id: nanoid(8), internId: PAST_INTERN_ID, weekOf: "2025-08-11",
    title: "Handoff doc + runbook", description: "Wrote operational handoff for the data team. Anomaly detector still in production today.",
    department: "data", projectName: "Anomaly detection" },
];
const PAST_GOALS: LearningGoal[] = [
  { id: nanoid(8), internId: PAST_INTERN_ID, title: "Ship a real production system",
    description: "End-to-end ownership of one service that runs in prod after the internship ends.",
    status: "achieved",
    checkIns: [
      { id: nanoid(8), date: "2025-08-22", note: "Anomaly detector handed off; still running.", author: "Theo Nakamura" },
    ] },
  { id: nanoid(8), internId: PAST_INTERN_ID, title: "Get fluent with BigQuery",
    description: "Comfortable writing complex windowed queries unaided.",
    status: "achieved", checkIns: [] },
];
const PAST_KUDOS: Kudos[] = [
  { id: nanoid(8), internId: PAST_INTERN_ID, fromName: "Marcus Chen", fromRole: "Staff data scientist",
    message: "The anomaly detector saved us a real customer escalation in week 6. Theo just shipped it.",
    createdAt: "2025-07-08T14:00:00Z" },
  { id: nanoid(8), internId: PAST_INTERN_ID, fromName: "Sara Hoffmann", fromRole: "Operations lead",
    message: "Theo's runbook is the cleanest doc on the wiki. New engineers cite it.",
    createdAt: "2025-08-19T11:30:00Z" },
];
const PAST_RETURN: ReturnOfferEntry[] = [
  { id: nanoid(8), internId: PAST_INTERN_ID, managerId: "ft-karim-alibhai",
    projectName: "Anomaly detection", recommendation: "would-hire",
    note: "Top of cohort. Direct hire if a data role opens.",
    createdAt: "2025-08-22T17:00:00Z" },
];

// ----- Two more active interns -----
// Jordan Lee — finance / data lean. Same program window as Mira so the
// active-cohort view feels populated and overlapping.
const JORDAN_ID = "intern-jordan";
const JORDAN: Intern = {
  id: JORDAN_ID,
  name: "Jordan Lee",
  photoUrl: "/avatars/jordan.svg",
  school: "NYU Stern",
  programStart: "2026-04-06",
  programEnd: "2026-08-14",
  status: "active",
  bio: "Finance & econ senior at Stern with a side habit in SQL and pandas. " +
       "Spent last summer on Goldman's hotel coverage team. This internship I want to live on the deal side — " +
       "underwriting models, pricing, and how the operating side feeds the financial side.",
  resume: {
    education: [
      {
        id: nanoid(8),
        school: "NYU Stern School of Business",
        degree: "B.S.", field: "Finance & Economics",
        startYear: 2022, endYear: 2026, gpa: "3.78",
        honors: "Stern Honors Program",
      },
    ],
    experience: [
      {
        id: nanoid(8),
        company: "Goldman Sachs",
        role: "Investment banking summer analyst — hotel coverage",
        startDate: "2025-06", endDate: "2025-08",
        description: "Built underwriting models for two pending hotel acquisitions. Promoted to a return-offer pool of 6/24.",
      },
      {
        id: nanoid(8),
        company: "NYU Stern Investment Analysis Group",
        role: "Real estate sector co-lead",
        startDate: "2024-09",
        description: "Run weekly research sessions for ~20 students. Authored two stock pitches that got circulated to the firm's partners.",
      },
    ],
    projects: [
      {
        id: nanoid(8), name: "Hotel comp scraper",
        description: "Python tool that pulls comparable-set ADR/RevPAR from STR weekly reports and emits a clean comp-set PDF.",
        link: "https://github.com/example/hotel-comps",
        technologies: ["Python", "pandas", "ReportLab"],
      },
    ],
    links: [
      { id: nanoid(8), label: "LinkedIn", url: "https://linkedin.com/in/jordan-lee" },
    ],
  },
  mentorId: "ft-alessandro-colantonio",
};
const JORDAN_SKILLS: SkillEntry[] = [
  { id: nanoid(8), skillTagId: "tag-sql",         proficiency: "strong",   category: "current" },
  { id: nanoid(8), skillTagId: "tag-python",      proficiency: "working",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-pandas",      proficiency: "working",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-stakeholder", proficiency: "working",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-fintech",     proficiency: "working",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-real-estate", proficiency: "working",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-ml",          proficiency: "beginner", category: "developing" },
  { id: nanoid(8), skillTagId: "tag-aws",         proficiency: "beginner", category: "developing" },
];

// Aiden Patel — design / research lean. Lighter overlap with Mira so
// his schedule reads differently.
const AIDEN_ID = "intern-aiden";
const AIDEN: Intern = {
  id: AIDEN_ID,
  name: "Aiden Patel",
  photoUrl: "/avatars/aiden.svg",
  school: "Carnegie Mellon HCI",
  programStart: "2026-04-13",
  programEnd: "2026-08-21",
  status: "active",
  bio: "First-year HCI master's at CMU after three years as a product designer at a Series B fintech. " +
       "Looking to ground my design work in research and to spend a real summer near the operations and " +
       "ops-cadence side — the parts of a product that don't show up in a Figma file.",
  resume: {
    education: [
      {
        id: nanoid(8),
        school: "Carnegie Mellon University",
        degree: "M.A.", field: "Human–Computer Interaction",
        startYear: 2025, endYear: 2027,
      },
      {
        id: nanoid(8),
        school: "Rhode Island School of Design",
        degree: "B.F.A.", field: "Graphic Design",
        startYear: 2017, endYear: 2021, gpa: "3.92",
      },
    ],
    experience: [
      {
        id: nanoid(8),
        company: "Stripe (via Highline)",
        role: "Senior product designer",
        startDate: "2022-08", endDate: "2025-05",
        description: "Owned design for the merchant onboarding surface. Cut median time-to-first-charge 38%.",
      },
      {
        id: nanoid(8),
        company: "IDEO",
        role: "Design intern",
        startDate: "2021-06", endDate: "2021-08",
        description: "Healthcare team. Field research on home-dialysis patients in three cities.",
      },
    ],
    projects: [
      {
        id: nanoid(8), name: "Operating cadence audit kit",
        description: "Open-source toolkit (Figma + Notion templates) for diagnosing weak points in a team's operating cadence. Used by ~40 teams.",
        link: "https://aidenpatel.com/cadence",
        technologies: ["Figma", "Notion", "Research methods"],
      },
    ],
    links: [
      { id: nanoid(8), label: "Portfolio", url: "https://aidenpatel.com" },
      { id: nanoid(8), label: "LinkedIn",  url: "https://linkedin.com/in/aiden-patel" },
    ],
  },
  mentorId: "ft-ignasi-puig",
};
const AIDEN_SKILLS: SkillEntry[] = [
  { id: nanoid(8), skillTagId: "tag-figma",        proficiency: "strong",   category: "current" },
  { id: nanoid(8), skillTagId: "tag-ui",           proficiency: "strong",   category: "current" },
  { id: nanoid(8), skillTagId: "tag-ux-research",  proficiency: "strong",   category: "current" },
  { id: nanoid(8), skillTagId: "tag-user-interviews", proficiency: "strong", category: "current" },
  { id: nanoid(8), skillTagId: "tag-presenting",   proficiency: "working",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-prd",          proficiency: "working",  category: "developing" },
  { id: nanoid(8), skillTagId: "tag-stats",        proficiency: "beginner", category: "developing" },
];

// ----- Two more past interns to give the archive depth -----
const MAYA_ID = "intern-maya";
const MAYA: Intern = {
  id: MAYA_ID,
  name: "Maya Okonkwo",
  photoUrl: "/avatars/maya.svg",
  school: "UC Berkeley",
  programStart: "2024-05-20",
  programEnd: "2024-08-23",
  status: "completed",
  bio: "EECS grad, summer 2024 cohort. Built the first version of the company-wide reporting cube and " +
       "left documentation tight enough that the data team still calls it the 'Maya cube.'",
  resume: {
    education: [
      { id: nanoid(8), school: "UC Berkeley", degree: "B.S.", field: "Electrical Engineering & Computer Sciences",
        startYear: 2020, endYear: 2024, gpa: "3.86" },
    ],
    experience: [
      { id: nanoid(8), company: "Snowflake", role: "Data engineering intern",
        startDate: "2023-06", endDate: "2023-08",
        description: "Worked on snapshot-isolation testing for Time Travel queries." },
    ],
    projects: [
      { id: nanoid(8), name: "Reporting cube", description: "Star-schema reporting cube the operating team still uses every Monday.",
        technologies: ["dbt", "Snowflake", "Looker"] },
    ],
    links: [{ id: nanoid(8), label: "GitHub", url: "https://github.com/maya-o" }],
  },
};
const MAYA_SKILLS: SkillEntry[] = [
  { id: nanoid(8), skillTagId: "tag-sql",     proficiency: "strong",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-python",  proficiency: "strong",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-tableau", proficiency: "working", category: "current" },
];

const DANIEL_ID = "intern-daniel";
const DANIEL: Intern = {
  id: DANIEL_ID,
  name: "Daniel Park",
  photoUrl: "/avatars/daniel.svg",
  school: "Northwestern Kellogg",
  programStart: "2024-06-03",
  programEnd: "2024-08-30",
  status: "completed",
  bio: "Kellogg MBA candidate, 2024 summer. Spent the summer in product management — owned the v1 spec " +
       "for the partner-incentive program that went into the 2025 commercial plan.",
  resume: {
    education: [
      { id: nanoid(8), school: "Northwestern Kellogg", degree: "M.B.A.",
        startYear: 2023, endYear: 2025 },
      { id: nanoid(8), school: "University of Illinois Urbana-Champaign", degree: "B.S.", field: "Industrial Engineering",
        startYear: 2014, endYear: 2018 },
    ],
    experience: [
      { id: nanoid(8), company: "McKinsey & Company", role: "Engagement manager",
        startDate: "2018-08", endDate: "2023-06",
        description: "Five years in McKinsey's consumer practice. Last engagement was a hospitality-portfolio repositioning." },
    ],
    projects: [],
    links: [{ id: nanoid(8), label: "LinkedIn", url: "https://linkedin.com/in/daniel-park" }],
  },
};
const DANIEL_SKILLS: SkillEntry[] = [
  { id: nanoid(8), skillTagId: "tag-prd",         proficiency: "strong",  category: "current" },
  { id: nanoid(8), skillTagId: "tag-roadmap",     proficiency: "working", category: "current" },
  { id: nanoid(8), skillTagId: "tag-stakeholder", proficiency: "strong",  category: "current" },
];

// ----- Schedules for the new active interns -----
// Jordan tours data → product → finance side; Aiden tours design and
// research with a few cross-team weeks.
const JORDAN_PLAN: Parameters<typeof buildSchedule>[1] = [
  { offset: -1, days: [
    { day: 0, am: data("Reporting onboarding"),     pm: data("Reporting onboarding") },
    { day: 1, am: data("Reporting onboarding"),     pm: data("Reporting onboarding") },
    { day: 2, am: data("Reporting onboarding"),     pm: prod("Pricing model walk-through") },
    { day: 3, am: prod("Pricing model walk-through"), pm: prod("Pricing model walk-through") },
    { day: 4, am: data("Reporting onboarding"),     pm: ops("Operating cadence overview") },
  ]},
  { offset: 0, days: [
    { day: 0, am: data("Pricing model build"),  pm: data("Pricing model build") },
    { day: 1, am: data("Pricing model build"),  pm: data("Pricing model build") },
    { day: 2, am: data("Pricing model build"),  pm: prod("Pricing PRD draft") },
    { day: 3, am: prod("Pricing PRD draft"),    pm: prod("Pricing PRD draft") },
    { day: 4, am: data("Pricing model build"),  pm: data("Pricing model build") },
  ]},
  { offset: 1, days: [
    { day: 0, am: data("Underwriting tour"),    pm: data("Underwriting tour") },
    { day: 1, am: data("Underwriting tour"),    pm: data("Underwriting tour") },
    { day: 2, am: data("Underwriting tour"),    pm: data("Underwriting tour") },
    { day: 3, am: prod("Comp-set build"),       pm: prod("Comp-set build") },
    { day: 4, am: prod("Comp-set build"),       pm: prod("Comp-set build") },
  ]},
];
const AIDEN_PLAN: Parameters<typeof buildSchedule>[1] = [
  { offset: 0, days: [
    { day: 0, am: design("Design onboarding"),  pm: design("Design onboarding") },
    { day: 1, am: design("Design onboarding"),  pm: design("Design onboarding") },
    { day: 2, am: design("Design onboarding"),  pm: prod("Product crit shadow") },
    { day: 3, am: design("Design onboarding"),  pm: design("Design onboarding") },
    { day: 4, am: design("Design onboarding"),  pm: ops("Cadence interview prep") },
  ]},
  { offset: 1, days: [
    { day: 0, am: design("Brand refresh"),      pm: design("Brand refresh") },
    { day: 1, am: design("Brand refresh"),      pm: design("Brand refresh") },
    { day: 2, am: design("Brand refresh"),      pm: design("Brand refresh") },
    { day: 3, am: design("Brand refresh"),      pm: prod("Pricing PRD review") },
    { day: 4, am: design("Brand refresh"),      pm: design("Brand refresh") },
  ]},
  { offset: 2, days: [
    { day: 0, am: design("Onboarding redesign"), pm: design("Onboarding redesign") },
    { day: 1, am: design("Onboarding redesign"), pm: design("Onboarding redesign") },
    { day: 2, am: design("Onboarding redesign"), pm: prod("Spec writing rotation") },
    { day: 3, am: design("Onboarding redesign"), pm: design("Onboarding redesign") },
    { day: 4, am: design("Onboarding redesign"), pm: design("Onboarding redesign") },
  ]},
];

// A tiny dose of phase-2/4 data per new intern so the rest of the
// surfaces (deliverables, kudos) don't read as empty when stakeholders
// click in.
const JORDAN_DELIVERABLES: Deliverable[] = [
  { id: nanoid(8), internId: JORDAN_ID, weekOf: "2026-04-13",
    title: "Pricing comp-set v1", description: "First-cut comp set for the upcoming pricing PRD. Pulled four operators across two markets.",
    department: "data", projectName: "Pricing model build" },
];
const JORDAN_GOALS: LearningGoal[] = [
  { id: nanoid(8), internId: JORDAN_ID, title: "Run a real underwriting model end-to-end",
    description: "Build, sensitivity-test, and present an underwriting model for one live deal.",
    status: "on-track", checkIns: [] },
  { id: nanoid(8), internId: JORDAN_ID, title: "Get fluent enough in pandas to leave SQL behind for ad-hoc work",
    description: "Comfortable enough that I default to a notebook for quick analyses by week 6.",
    status: "on-track", checkIns: [] },
];
const JORDAN_KUDOS: Kudos[] = [
  { id: nanoid(8), internId: JORDAN_ID, fromName: "David Okafor", fromRole: "Senior product manager",
    message: "Jordan ran the comp-set with the kind of crispness I expect from a third-year analyst. Rare at week two.",
    createdAt: "2026-04-17T13:00:00Z" },
];

const AIDEN_DELIVERABLES: Deliverable[] = [
  { id: nanoid(8), internId: AIDEN_ID, weekOf: "2026-04-13",
    title: "Brand-refresh research plan", description: "Five-page plan + interview guide for the brand refresh. Approved by Priya and the marketing lead.",
    department: "design", projectName: "Design onboarding" },
];
const AIDEN_GOALS: LearningGoal[] = [
  { id: nanoid(8), internId: AIDEN_ID, title: "Run my first solo design crit",
    description: "Lead a critique session with engineers in the room — not just designers.",
    status: "on-track", checkIns: [] },
];
const AIDEN_KUDOS: Kudos[] = [
  { id: nanoid(8), internId: AIDEN_ID, fromName: "Priya Raman", fromRole: "Head of design",
    message: "Aiden walked into the brand-refresh kickoff like he'd been here for years. Thoughtful, calm, well-prepped.",
    createdAt: "2026-04-15T09:30:00Z" },
];

// Past-intern flair so portfolios aren't empty when someone clicks in.
const MAYA_DELIVERABLES: Deliverable[] = [
  { id: nanoid(8), internId: MAYA_ID, weekOf: "2024-07-15", title: "Reporting cube v1",
    description: "Star-schema cube spanning bookings, ADR, occupancy, and labor. Replaced four spreadsheets.",
    department: "data", projectName: "Reporting cube" },
];
const MAYA_KUDOS: Kudos[] = [
  { id: nanoid(8), internId: MAYA_ID, fromName: "Marcus Chen", fromRole: "Staff data scientist",
    message: "Six months later we still call it the Maya cube. The bar she set for documentation is the bar now.",
    createdAt: "2024-08-21T15:00:00Z" },
];
const MAYA_RETURN: ReturnOfferEntry[] = [
  { id: nanoid(8), internId: MAYA_ID, managerId: "ft-karim-alibhai", projectName: "Reporting cube",
    recommendation: "would-hire",
    note: "Strongest data intern we've had. Would re-hire in a heartbeat.",
    createdAt: "2024-08-23T17:00:00Z" },
];
const DANIEL_DELIVERABLES: Deliverable[] = [
  { id: nanoid(8), internId: DANIEL_ID, weekOf: "2024-08-12", title: "Partner-incentive program v1",
    description: "First-draft spec for the 2025 partner-incentive program. Adopted with one round of edits.",
    department: "product", projectName: "Partner incentive" },
];
const DANIEL_KUDOS: Kudos[] = [
  { id: nanoid(8), internId: DANIEL_ID, fromName: "David Okafor", fromRole: "Senior product manager",
    message: "Daniel's spec is the cleanest piece of writing I've seen from anyone in their first PM rotation.",
    createdAt: "2024-08-26T17:00:00Z" },
];

// ----- Coffee chat requests (a couple of in-flight ones) -----
const COFFEE_CHATS: CoffeeChatRequest[] = [
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, fullTimerId: "ft-alessandro-colantonio",
    topic: "Curious about the PM-from-engineering jump.",
    status: "scheduled", scheduledFor: "2026-04-30T17:00:00Z",
    createdAt: "2026-04-22T13:00:00Z" },
  { id: nanoid(8), internId: ACTIVE_INTERN_ID, fullTimerId: "ft-ignasi-puig",
    topic: "Portfolio review — open to honest feedback.",
    status: "pending",
    createdAt: "2026-04-24T18:45:00Z" },
];

// ----- Public seed -----
export const SEED = {
  fullTimers: FULL_TIMERS,
  skillTags: SKILL_TAGS,
  interns: [ACTIVE_INTERN, JORDAN, AIDEN, PAST_INTERN, MAYA, DANIEL] as Intern[],
  internSkills: {
    [ACTIVE_INTERN_ID]: ACTIVE_INTERN_SKILLS,
    [JORDAN_ID]: JORDAN_SKILLS,
    [AIDEN_ID]: AIDEN_SKILLS,
    [PAST_INTERN_ID]: PAST_INTERN_SKILLS,
    [MAYA_ID]: MAYA_SKILLS,
    [DANIEL_ID]: DANIEL_SKILLS,
  } as Record<string, SkillEntry[]>,
  scheduleBlocks: [
    ...buildActiveSchedule(),
    ...buildSchedule(JORDAN_ID, JORDAN_PLAN),
    ...buildSchedule(AIDEN_ID,  AIDEN_PLAN),
  ],
  deliverables: [
    ...DELIVERABLES, ...PAST_DELIVERABLES,
    ...JORDAN_DELIVERABLES, ...AIDEN_DELIVERABLES,
    ...MAYA_DELIVERABLES, ...DANIEL_DELIVERABLES,
  ],
  learningGoals: [...LEARNING_GOALS, ...PAST_GOALS, ...JORDAN_GOALS, ...AIDEN_GOALS],
  feedback: FEEDBACK,
  kudos: [
    ...KUDOS, ...PAST_KUDOS,
    ...JORDAN_KUDOS, ...AIDEN_KUDOS,
    ...MAYA_KUDOS, ...DANIEL_KUDOS,
  ],
  returnOffers: [...RETURN_OFFERS, ...PAST_RETURN, ...MAYA_RETURN],
  shadowDays: SHADOW_DAYS,
  coffeeChats: COFFEE_CHATS,
} as const;
