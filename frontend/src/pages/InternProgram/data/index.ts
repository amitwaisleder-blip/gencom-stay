// Single import point for the data layer. UI code does:
//
//     import { getStore } from "@/data";
//     const interns = await getStore().listInterns();
//
// Swap to a Prisma-backed store later by writing prisma-store.ts that
// implements InternStore and changing the one line below. No other
// file should ever import a concrete store implementation.

import type { InternStore } from "./store";
import { memoryStore } from "./memory-store";

export type { InternStore } from "./store";

export function getStore(): InternStore {
  return memoryStore();
}

// Re-exports so consumers can type without reaching into ./types directly.
export type {
  CoffeeChatRequest, DateRange, Deliverable, Department, DayHalf, Education,
  Experience, FullTimer, Intern, InternStatus, Kudos, LearningGoal,
  ManagerFeedback, Project, Proficiency, ResumeLink, Resume, ResumeFile, ReturnOfferEntry,
  Role, ScheduleBlock, ShadowDayRequest, SkillEntry, SkillGroup, SkillTag,
} from "./types";
