// Client-side action wrappers around the InternStore. These replace
// the Next.js server actions (app/actions.ts) used by the original
// module — the data layer lives entirely in the browser via
// localStorage, so no server round-trip is needed.
//
// Components import { saveBioAction } from "@/app/actions" today; this
// re-export keeps that import path stable so the ported components
// don't all need to be rewritten.

import {
  getStore, type CoffeeChatRequest, type Deliverable, type FullTimer,
  type Intern, type Kudos, type LearningGoal, type ManagerFeedback,
  type ReturnOfferEntry, type ScheduleBlock, type ShadowDayRequest,
  type SkillEntry, type SkillGroup,
} from "@/data";

export async function saveBioAction(
  internId: string,
  patch: { name?: string; bio?: string; school?: string; photoUrl?: string; programStart?: string; programEnd?: string },
) {
  await getStore().updateIntern(internId, patch);
}

export async function saveResumeAction(internId: string, resume: Intern["resume"]) {
  await getStore().setResume(internId, resume);
}

export async function setResumeFileAction(
  internId: string,
  file: Intern["resumeFile"] | null,
) {
  await getStore().setResumeFile(internId, file);
}

export async function deleteInternAction(internId: string) {
  await getStore().deleteIntern(internId);
}

export async function addInternAction(input: {
  name: string;
  school: string;
  programStart: string;
  programEnd: string;
  bio?: string;
  status?: Intern["status"];
}) {
  return getStore().addIntern(input);
}

export async function saveSkillsAction(internId: string, skills: SkillEntry[]) {
  await getStore().setInternSkills(internId, skills);
}

export async function requestNewSkillTagAction(label: string, group: SkillGroup) {
  return getStore().requestNewSkillTag(label, group);
}

export async function upsertScheduleBlockAction(block: ScheduleBlock) {
  return getStore().upsertScheduleBlock(block);
}

export async function deleteScheduleBlockAction(_internId: string, blockId: string) {
  await getStore().deleteScheduleBlock(blockId);
}

export async function proposeScheduleChangeAction(
  fromBlockId: string,
  proposed: Omit<ScheduleBlock, "id" | "status" | "proposedBy">,
) {
  return getStore().proposeScheduleChange(fromBlockId, proposed);
}

// ---------- Phase 2 ----------
export async function upsertDeliverableAction(d: Deliverable) {
  return getStore().upsertDeliverable(d);
}
export async function deleteDeliverableAction(_internId: string, id: string) {
  await getStore().deleteDeliverable(id);
}

export async function upsertLearningGoalAction(g: LearningGoal) {
  return getStore().upsertLearningGoal(g);
}
export async function deleteLearningGoalAction(_internId: string, id: string) {
  await getStore().deleteLearningGoal(id);
}
export async function addGoalCheckInAction(
  _internId: string,
  goalId: string,
  checkIn: { date: string; note: string; author: string },
) {
  return getStore().addGoalCheckIn(goalId, checkIn);
}

export async function upsertManagerFeedbackAction(f: ManagerFeedback) {
  return getStore().upsertManagerFeedback(f);
}
export async function deleteManagerFeedbackAction(_internId: string, id: string) {
  await getStore().deleteManagerFeedback(id);
}

// ---------- Phase 3 ----------
export async function setMentorAction(internId: string, mentorId: string | null) {
  await getStore().updateIntern(internId, { mentorId: mentorId ?? undefined });
}

export async function updateFullTimerAction(id: string, patch: Partial<FullTimer>) {
  return getStore().updateFullTimer(id, patch);
}

export async function upsertShadowDayAction(r: ShadowDayRequest) {
  return getStore().upsertShadowDayRequest(r);
}
export async function deleteShadowDayAction(_internId: string, id: string) {
  await getStore().deleteShadowDayRequest(id);
}

export async function upsertCoffeeChatAction(r: CoffeeChatRequest) {
  return getStore().upsertCoffeeChatRequest(r);
}
export async function deleteCoffeeChatAction(id: string) {
  await getStore().deleteCoffeeChatRequest(id);
}

// ---------- Phase 4 ----------
export async function postKudosAction(k: Kudos) {
  return getStore().upsertKudos(k);
}
export async function deleteKudosAction(_internId: string, id: string) {
  await getStore().deleteKudos(id);
}

export async function upsertReturnOfferAction(r: ReturnOfferEntry) {
  return getStore().upsertReturnOffer(r);
}
export async function deleteReturnOfferAction(_internId: string, id: string) {
  await getStore().deleteReturnOffer(id);
}
