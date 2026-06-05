import type { Department, SkillGroup } from "./types";

// Department metadata — colors live in tailwind.config.ts under
// `colors.dept.*`. Order here is the preferred display order across
// the app (legends, mix bars, dropdowns).
// Gencom org departments. Keys are kept from the original demo seed so
// existing ScheduleBlock / FullTimer rows still resolve; labels are the
// names the company actually uses on the org chart.
export const DEPARTMENTS: { key: Department; label: string }[] = [
  { key: "engineering", label: "Design + Construction" },
  { key: "design",      label: "Interior Design" },
  { key: "data",        label: "Capital Markets" },
  { key: "marketing",   label: "Legal" },
  { key: "product",     label: "Acquisitions" },
  { key: "finance",     label: "Finance" },
  { key: "operations",  label: "Accounting" },
  { key: "tax",         label: "Tax" },
];

export const departmentLabel = (d: Department): string =>
  DEPARTMENTS.find((x) => x.key === d)?.label ?? d;

export const departmentColorVar = (d: Department): string =>
  `var(--tw-color-dept-${d}, hsl(220 9% 60%))`;

// Tailwind class helpers — keep dept color usage centralized so adding
// a new dept is a one-file change.
export const deptBgClass = (d: Department): string => ({
  engineering: "bg-dept-engineering",
  product:     "bg-dept-product",
  design:      "bg-dept-design",
  data:        "bg-dept-data",
  operations:  "bg-dept-operations",
  marketing:   "bg-dept-marketing",
  finance:     "bg-dept-finance",
  tax:         "bg-dept-tax",
}[d]);

export const deptTextClass = (d: Department): string => ({
  engineering: "text-dept-engineering",
  product:     "text-dept-product",
  design:      "text-dept-design",
  data:        "text-dept-data",
  operations:  "text-dept-operations",
  marketing:   "text-dept-marketing",
  finance:     "text-dept-finance",
  tax:         "text-dept-tax",
}[d]);

export const SKILL_GROUPS: { key: SkillGroup; label: string }[] = [
  { key: "engineering",   label: "Engineering" },
  { key: "data",          label: "Data" },
  { key: "design",        label: "Design" },
  { key: "product",       label: "Product" },
  { key: "operations",    label: "Operations" },
  { key: "communication", label: "Communication" },
  { key: "domain",        label: "Domain knowledge" },
];

export const skillGroupLabel = (g: SkillGroup): string =>
  SKILL_GROUPS.find((x) => x.key === g)?.label ?? g;

// Controlled vocabulary of skill tags. Interns pick from this list;
// "request new tag" appends an unapproved entry that HR can later mark
// approved. Keep the seed list small but covering — better to have HR
// add the long tail than overwhelm the picker on day one.
export const SEED_SKILL_TAGS: { id: string; label: string; group: SkillGroup }[] = [
  // Engineering
  { id: "tag-typescript", label: "TypeScript", group: "engineering" },
  { id: "tag-python",     label: "Python",     group: "engineering" },
  { id: "tag-react",      label: "React",      group: "engineering" },
  { id: "tag-nextjs",     label: "Next.js",    group: "engineering" },
  { id: "tag-node",       label: "Node.js",    group: "engineering" },
  { id: "tag-go",         label: "Go",         group: "engineering" },
  { id: "tag-aws",        label: "AWS",        group: "engineering" },
  { id: "tag-docker",     label: "Docker",     group: "engineering" },
  { id: "tag-testing",    label: "Testing",    group: "engineering" },
  // Data
  { id: "tag-sql",        label: "SQL",        group: "data" },
  { id: "tag-pandas",     label: "pandas",     group: "data" },
  { id: "tag-tableau",    label: "Tableau",    group: "data" },
  { id: "tag-ml",         label: "Machine learning", group: "data" },
  { id: "tag-stats",      label: "Statistics", group: "data" },
  // Design
  { id: "tag-figma",      label: "Figma",      group: "design" },
  { id: "tag-ui",         label: "UI design",  group: "design" },
  { id: "tag-ux-research",label: "UX research",group: "design" },
  // Product
  { id: "tag-prd",        label: "Spec writing", group: "product" },
  { id: "tag-roadmap",    label: "Roadmapping", group: "product" },
  { id: "tag-user-interviews", label: "User interviews", group: "product" },
  // Operations
  { id: "tag-pm",         label: "Project mgmt", group: "operations" },
  { id: "tag-jira",       label: "Jira / Linear", group: "operations" },
  // Communication
  { id: "tag-writing",    label: "Writing",    group: "communication" },
  { id: "tag-presenting", label: "Presenting", group: "communication" },
  { id: "tag-stakeholder", label: "Stakeholder mgmt", group: "communication" },
  // Domain
  { id: "tag-fintech",    label: "Fintech",    group: "domain" },
  { id: "tag-real-estate", label: "Real estate", group: "domain" },
  { id: "tag-healthcare", label: "Healthcare", group: "domain" },
];

export const PROFICIENCY_LABEL = {
  beginner: "Beginner",
  working: "Working",
  strong: "Strong",
} as const;

// Used by the proficiency badge — calmer than red/yellow/green and
// reads as a progression (light → solid).
export const PROFICIENCY_DOTS = {
  beginner: 1,
  working: 2,
  strong: 3,
} as const;
