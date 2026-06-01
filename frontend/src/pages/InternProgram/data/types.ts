// Domain types for the intern module.
//
// Phase 1 types (Intern, Resume, Skills, FullTimer, ScheduleBlock) are
// fully implemented in memory-store.ts. Phase 2-4 types are sketched
// here so the InternStore interface stays stable as features land.

export type Role = "intern" | "manager" | "hr" | "exec";

// ---------- Intern + Resume ----------
export type InternStatus = "active" | "completed";

export type Intern = {
  id: string;
  name: string;
  photoUrl?: string;
  school: string;
  programStart: string;       // YYYY-MM-DD
  programEnd: string;         // YYYY-MM-DD
  status: InternStatus;
  bio: string;
  resume: Resume;
  /** Optional uploaded resume PDF/DOCX. Stored inline as a data URL in
   *  the same localStorage record as the rest of the intern (the module
   *  has no backend; the data layer is browser-only). */
  resumeFile?: ResumeFile;
  mentorId?: string;          // FullTimer.id (Phase 3 wiring lives in seed)
};

export type ResumeFile = {
  url: string;        // data: URL (base64) — also serves as the link href
  name: string;       // original filename
  uploadedAt: string; // ISO timestamp
};

export type Resume = {
  education: Education[];
  experience: Experience[];
  projects: Project[];
  links: ResumeLink[];
};

export type Education = {
  id: string;
  school: string;
  degree: string;
  field?: string;
  startYear: number;
  endYear?: number;           // null = in progress
  gpa?: string;
  honors?: string;
};

export type Experience = {
  id: string;
  company: string;
  role: string;
  startDate: string;          // YYYY-MM
  endDate?: string;           // YYYY-MM, undefined = current
  description: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  link?: string;
  technologies: string[];
};

export type ResumeLink = {
  id: string;
  label: string;              // "GitHub", "LinkedIn", "Portfolio", …
  url: string;
};

// ---------- Skills ----------
export type Proficiency = "beginner" | "working" | "strong";

export type SkillGroup =
  | "engineering" | "design" | "product"
  | "data" | "operations" | "communication" | "domain";

export type SkillTag = {
  id: string;
  label: string;
  group: SkillGroup;
  approved: boolean;          // false = user-requested, awaiting HR approval
};

export type SkillEntry = {
  id: string;
  skillTagId: string;
  proficiency: Proficiency;
  category: "current" | "developing";
  note?: string;
};

// ---------- People ----------
// Department keys are stable strings so already-seeded ScheduleBlocks /
// FullTimers don't need migration. Labels (in vocabularies.ts) are the
// Gencom-org-specific names: Design + Construction, Capital Markets,
// Legal, Acquisitions, Finance, Accounting, Interior Design, Tax.
export type Department =
  | "engineering" | "product" | "design"
  | "data" | "operations" | "marketing" | "finance" | "tax";

export type FullTimer = {
  id: string;
  name: string;
  role: string;               // job title
  department: Department;
  photoUrl?: string;
  email?: string;
  isManager: boolean;
  isMentorAvailable: boolean;
  coffeeChatOptIn: boolean;
  coffeeChatBlurb?: string;
};

// ---------- Scheduler ----------
export type DayHalf = "AM" | "PM";

export type ScheduleBlock = {
  id: string;
  internId: string;
  date: string;               // YYYY-MM-DD (weekday only — enforced in store)
  half: DayHalf;
  projectName: string;
  department: Department;
  managerId: string;          // FullTimer.id with isManager === true
  notes?: string;
  status: "confirmed" | "proposed";
  proposedBy?: "manager" | "intern";
};

// ---------- Phase 2-4 sketches ----------
// These shapes drive seed data now (so the data file is complete) but
// have no UI yet. The store interface intentionally omits methods for
// these features until Phase 2 starts — keeps the surface honest.

export type Deliverable = {
  id: string; internId: string;
  weekOf: string;             // ISO Monday
  title: string; description: string; link?: string;
  projectName?: string; department?: Department;
};

export type LearningGoal = {
  id: string; internId: string;
  title: string; description: string;
  status: "on-track" | "at-risk" | "achieved";
  checkIns: { id: string; date: string; note: string; author: string }[];
};

export type ManagerFeedback = {
  id: string; internId: string; managerId: string;
  weekOf: string; rating: 1 | 2 | 3 | 4 | 5; note: string;
};

export type Kudos = {
  id: string; internId: string; fromName: string; fromRole: string;
  message: string; createdAt: string;
};

export type ReturnOfferEntry = {
  id: string; internId: string; managerId: string; projectName: string;
  recommendation: "would-hire" | "would-not" | "needs-more-time";
  note: string; createdAt: string;
};

export type ShadowDayRequest = {
  id: string; internId: string; targetDepartment: Department;
  requestedDate: string;                      // YYYY-MM-DD
  half: DayHalf;                              // matches schedule granularity
  reason: string;                             // why the intern wants this
  status: "pending" | "approved" | "declined";
  approvedBy?: string;                        // FullTimer.id
  decisionNote?: string;
  createdAt: string;
};

export type CoffeeChatRequest = {
  id: string;
  internId: string;
  fullTimerId: string;
  topic: string;
  status: "pending" | "scheduled" | "declined" | "completed";
  scheduledFor?: string;                      // optional ISO datetime
  createdAt: string;
  decisionNote?: string;
};

// ---------- Range helpers ----------
export type DateRange = { from: string; to: string };  // inclusive ISO dates
