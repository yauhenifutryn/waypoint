import type { ApprovalRecord, Role, Tier } from "./types";

export { canAutoApprove } from "./risk";

/**
 * Lifecycle: submitted → validating → blocked | needs_review → rejected |
 * approved → deploying → live → retired | superseded. Demotion returns live →
 * needs_review. Guards are pure so the API layer stays thin.
 */

export type VersionState =
  | "submitted"
  | "validating"
  | "blocked"
  | "needs_review"
  | "rejected"
  | "approved"
  | "deploying"
  | "live"
  | "retired"
  | "superseded";

const ALLOWED: Record<VersionState, VersionState[]> = {
  submitted: ["validating"],
  validating: ["blocked", "needs_review", "approved"],
  blocked: ["needs_review"], // revalidation after fix; needs_review only via resubmit flow
  needs_review: ["approved", "rejected", "blocked"],
  approved: ["deploying", "needs_review"],
  rejected: ["needs_review"],
  deploying: ["live", "needs_review", "blocked"],
  live: ["retired", "superseded", "needs_review", "deploying"],
  retired: [],
  superseded: ["needs_review"], // rollback of a superseded version re-enters review as an emergency change
};

export function canTransition(from: VersionState, to: VersionState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** Roles whose approval satisfies each tier. Owner NEVER approves own work. */
export function requiredApprovers(tier: Tier): Array<"platform_reviewer" | "security_reviewer"> {
  switch (tier) {
    case 1:
      return [];
    case 2:
      return ["platform_reviewer"];
    case 3:
      return ["platform_reviewer", "security_reviewer"];
  }
}

export interface ApprovalEvaluation {
  satisfied: boolean;
  rejected: boolean;
  missingRoles: Array<"platform_reviewer" | "security_reviewer">;
}

export function evaluateApprovals(tier: Tier, approvals: ApprovalRecord[]): ApprovalEvaluation {
  const rejected = approvals.some((a) => a.decision === "rejected");
  const missingRoles = requiredApprovers(tier).filter(
    (role) => !approvals.some((a) => a.role === role && a.decision === "approved"),
  );
  return { satisfied: !rejected && missingRoles.length === 0, rejected, missingRoles };
}

/** Which actions a given role may take on a version right now. */
export function allowedActions(params: {
  state: VersionState;
  role: Role;
  tier: Tier;
  approvals: ApprovalRecord[];
}): Array<"approve" | "reject" | "deploy" | "stop" | "rollback" | "retire"> {
  const { state, role, tier, approvals } = params;
  const actions: Array<"approve" | "reject" | "deploy" | "stop" | "rollback" | "retire"> = [];
  const approverRoles: Role[] = ["platform_reviewer", "security_reviewer", "platform_admin"];

  if (state === "needs_review" && approverRoles.includes(role) && role !== "owner") {
    actions.push("approve", "reject");
  }
  if ((state === "approved" || state === "live") && (role === "platform_admin" || role === "platform_reviewer")) {
    if (state === "approved" && evaluateApprovals(tier, approvals).satisfied) actions.push("deploy");
    if (state === "live") {
      actions.push("stop", "rollback", "deploy");
    }
  }
  if (state === "live" && role === "platform_admin") actions.push("retire");
  return actions;
}
