"use server";

import { statSync } from "node:fs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Role } from "@/lib/engine/types";
import { actOnVersion, requestDeploy, rollback, stopDeployment, submitFromSource } from "@/server/service";
import { triggerManualRun } from "@/server/supervisor/main";

const ROLES: Role[] = ["owner", "platform_reviewer", "security_reviewer", "auditor", "platform_admin"];

const ACTOR_LABELS: Record<Role, string> = {
  owner: "Owner",
  platform_reviewer: "Pia Platform",
  security_reviewer: "Sam Security",
  platform_admin: "Ada Admin",
  auditor: "Auditor",
};

export async function currentRole(): Promise<Role> {
  const store = await cookies();
  const v = store.get("wp_role")?.value as Role | undefined;
  return v && ROLES.includes(v) ? v : "owner";
}

function cleanBack(back: string): string {
  try {
    const u = new URL(back, "http://x");
    u.searchParams.delete("error");
    return u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : "");
  } catch {
    return "/";
  }
}

function errTo(back: string, message: string): never {
  redirect(`${cleanBack(back)}?error=${encodeURIComponent(message)}`);
}

async function guarded(
  formData: FormData,
  allowed: Role[],
  why: string,
  run: (ctx: { role: Role; label: string }) => void | Promise<void>,
): Promise<never> {
  const back = String(formData.get("back") || "/");
  const role = await currentRole();
  if (!allowed.includes(role)) errTo(back, `Separation of duties: ${why} (you are acting as ${ACTOR_LABELS[role]}).`);
  try {
    await run({ role, label: ACTOR_LABELS[role] });
  } catch (e) {
    errTo(back, e instanceof Error ? e.message : String(e));
  }
  revalidatePath("/", "layout");
  redirect(cleanBack(back));
}

export type SubmitState = { errors: string[] } | null;

export async function submitApp(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const sourcePath = String(formData.get("sourcePath") ?? "").trim();
  if (!sourcePath) return { errors: ["Source path is required."] };
  if (!sourcePath.startsWith("/")) return { errors: ["Use an absolute path, e.g. /Users/you/project."] };
  let stat;
  try {
    stat = statSync(sourcePath);
  } catch {
    return { errors: [`Directory not found: ${sourcePath}`] };
  }
  if (!stat.isDirectory()) return { errors: [`Not a directory: ${sourcePath}`] };
  const role = await currentRole();
  if (role === "auditor") return { errors: ["Auditors have read-only access; switch roles to submit."] };
  let result;
  try {
    result = await submitFromSource({ sourcePath, actorLabel: ACTOR_LABELS[role] });
  } catch (e) {
    const validationErrors = (e as { validationErrors?: unknown }).validationErrors;
    if (Array.isArray(validationErrors) && validationErrors.length > 0) {
      return { errors: validationErrors.map((v) => String(v)) };
    }
    return { errors: [e instanceof Error ? e.message : String(e)] };
  }
  revalidatePath("/", "layout");
  redirect(`/apps/${result.slug}`);
}

export async function approveVersion(formData: FormData): Promise<void> {
  const versionId = String(formData.get("versionId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  await guarded(
    formData,
    ["platform_reviewer", "security_reviewer", "platform_admin"],
    "owners and auditors cannot review submissions",
    ({ role, label }) => actOnVersion({ versionId, action: "approve", role, actorLabel: label, note: note || undefined }),
  );
}

export async function rejectVersion(formData: FormData): Promise<void> {
  const versionId = String(formData.get("versionId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  await guarded(
    formData,
    ["platform_reviewer", "security_reviewer", "platform_admin"],
    "owners and auditors cannot review submissions",
    ({ role, label }) => actOnVersion({ versionId, action: "reject", role, actorLabel: label, note: note || undefined }),
  );
}

export async function deployVersion(formData: FormData): Promise<void> {
  const versionId = String(formData.get("versionId") ?? "");
  await guarded(
    formData,
    ["owner", "platform_reviewer", "platform_admin"],
    "only owners with automatic approval or platform roles may deploy",
    ({ role, label }) => {
      requestDeploy({ versionId, role, actorLabel: label });
    },
  );
}

export async function stopDeploymentAction(formData: FormData): Promise<void> {
  const appId = String(formData.get("appId") ?? "");
  await guarded(
    formData,
    ["owner", "platform_reviewer", "platform_admin"],
    "only owners or platform roles may stop deployments",
    ({ role, label }) => stopDeployment({ appId, role, actorLabel: label }),
  );
}

export async function rollbackApp(formData: FormData): Promise<void> {
  const appId = String(formData.get("appId") ?? "");
  await guarded(
    formData,
    ["platform_reviewer", "platform_admin"],
    "only platform reviewer or admin may roll back",
    ({ role, label }) => {
      rollback({ appId, role, actorLabel: label });
    },
  );
}

export async function runJobNow(formData: FormData): Promise<void> {
  const deploymentId = String(formData.get("deploymentId") ?? "");
  await guarded(
    formData,
    ["owner", "platform_reviewer", "platform_admin"],
    "only owners or platform roles may trigger runs",
    () => {
      triggerManualRun(deploymentId);
    },
  );
}

export async function setRole(role: string): Promise<void> {
  if (!ROLES.includes(role as Role)) return;
  const store = await cookies();
  store.set("wp_role", role, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
