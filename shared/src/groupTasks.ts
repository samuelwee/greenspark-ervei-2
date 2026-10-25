import type { SupportGroupId } from "./supportGroups";

export const SOLUTIONS = {
  cooling: { title: "Cooling & medical-needs check", steps: "Confirm cooling and equipment needs; agree a specialist callback before the forecast event.", confirm: "Current needs, contact preferences and an appropriate callback time." },
  supply: { title: "Supply assistance review", steps: "Confirm the supply or prepay problem and ask the retailer about suitable reconnection or credit assistance.", confirm: "Current supply status and the retailer’s available assistance." },
  payment: { title: "Payment-plan review", steps: "Review the current arrangement and discuss an affordable payment schedule with the customer.", confirm: "Ability to pay and customer agreement before any account change." },
  hardship: { title: "Financial hardship assessment", steps: "Check available hardship support with each customer’s retailer and prepare any required information.", confirm: "Individual circumstances and program eligibility; assistance is not pre-approved." },
  concession: { title: "Concession record & eligibility check", steps: "Check the reported card or lapsed concession, request current documents and explain application or renewal steps.", confirm: "Valid documents and current eligibility before applying a concession." },
  coaching: { title: "Energy-coaching assessment", steps: "Review the usage pattern and home needs, then discuss a suitable coaching referral.", confirm: "The cause of the usage change and the customer’s interest in coaching." },
  information: { title: "Information check & follow-up", steps: "Confirm recorded needs, fill information gaps and agree when to check in again.", confirm: "Missing information does not mean that no support is needed." },
  contact: { title: "Accessible contact arrangements", steps: "Check interpreter or offline contact needs and agree a suitable way to reach the customer.", confirm: "Contact consent, current details and any interpreter requirements." },
} as const;
export type SolutionId = keyof typeof SOLUTIONS;
export const NEED_SOLUTIONS: Record<SupportGroupId, SolutionId[]> = {
  health: ["cooling"], supply: ["supply"], bills: ["payment", "hardship"], concessions: ["concession"], coaching: ["coaching"], monitor: ["information"],
};

export interface GroupTaskSelection {
  groupId: SupportGroupId;
  solutionId: SolutionId;
  eventDate: string;
  scope: string;
  personIds: string[];
}
export interface CreateGroupTask extends GroupTaskSelection { assigneeUserId: string; dueDate: string }
export interface GroupTask {
  id: string; groupId: SupportGroupId; solutionId: SolutionId;
  eventDate: string; scope: string; assigneeUserId: string; dueDate: string;
  createdBy: string; createdAt: string; version: number;
  cancelled: boolean; total: number; completed: number;
}
export interface GroupTaskMember {
  personId: string; caseId: string; displayName: string; accountNumber: string | null;
  completed: boolean;
}
export interface GroupTaskDetail {
  task: GroupTask; members: GroupTaskMember[]; page: number; pageCount: number;
}
export interface GroupTaskPreview { selected: number; eligible: number; duplicate: number; unavailable: number }
