"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ClubMembershipRole } from "@prisma/client";
import {
  addMember,
  updateMember,
  revokeMember,
  reAddMember,
} from "@/lib/admin/members";
import { requireAdmin } from "@/lib/admin/require-admin";
import { prisma } from "@/lib/db";

const addSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(["OWNER", "ADMIN", "CASHIER", "RUNNER"]),
});

const updateSchema = z.object({
  membershipId: z.string().min(1),
  name: z.string().min(1).max(120),
  role: z.enum(["OWNER", "ADMIN", "CASHIER", "RUNNER"]),
});

const idSchema = z.object({ membershipId: z.string().min(1) });

const reAddSchema = z.object({
  membershipId: z.string().min(1),
  role: z.enum(["OWNER", "ADMIN", "CASHIER", "RUNNER"]),
});

/** Reject ADMIN trying to do an OWNER-level action. */
function gateOwnerAction(callerRole: ClubMembershipRole, targetRole: ClubMembershipRole) {
  if (targetRole === "OWNER" && callerRole !== "OWNER") {
    throw new Error("Only OWNER can manage OWNER memberships");
  }
}

export async function addMemberAction(formData: FormData) {
  const caller = await requireAdmin();
  const club = await prisma.club.findUniqueOrThrow({ where: { id: caller.clubId } });
  const data = addSchema.parse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
  });
  gateOwnerAction(caller.role, data.role);
  await addMember({
    clubSlug: club.slug,
    email: data.email,
    name: data.name,
    role: data.role,
  });
  revalidatePath("/settings/members");
}

export async function updateMemberAction(formData: FormData) {
  const caller = await requireAdmin();
  const data = updateSchema.parse({
    membershipId: formData.get("membershipId"),
    name: formData.get("name"),
    role: formData.get("role"),
  });

  const target = await prisma.clubMembership.findUniqueOrThrow({
    where: { id: data.membershipId },
  });
  if (target.clubId !== caller.clubId) {
    throw new Error("Cross-club action rejected");
  }
  // ADMIN can't touch OWNER row, and ADMIN can't promote-to-OWNER.
  gateOwnerAction(caller.role, target.role);
  gateOwnerAction(caller.role, data.role);
  // No self-edit.
  if (target.userId === caller.userId) {
    throw new Error("Cannot edit your own membership");
  }
  await updateMember({
    membershipId: data.membershipId,
    name: data.name,
    role: data.role,
  });
  revalidatePath("/settings/members");
}

export async function revokeMemberAction(formData: FormData) {
  const caller = await requireAdmin();
  const data = idSchema.parse({ membershipId: formData.get("membershipId") });

  const target = await prisma.clubMembership.findUniqueOrThrow({
    where: { id: data.membershipId },
  });
  if (target.clubId !== caller.clubId) {
    throw new Error("Cross-club action rejected");
  }
  gateOwnerAction(caller.role, target.role);
  if (target.userId === caller.userId) {
    throw new Error("Cannot revoke yourself");
  }
  await revokeMember({ membershipId: data.membershipId });
  revalidatePath("/settings/members");
}

export async function reAddMemberAction(formData: FormData) {
  const caller = await requireAdmin();
  const data = reAddSchema.parse({
    membershipId: formData.get("membershipId"),
    role: formData.get("role"),
  });

  const target = await prisma.clubMembership.findUniqueOrThrow({
    where: { id: data.membershipId },
  });
  if (target.clubId !== caller.clubId) {
    throw new Error("Cross-club action rejected");
  }
  gateOwnerAction(caller.role, data.role);
  await reAddMember({ membershipId: data.membershipId, role: data.role });
  revalidatePath("/settings/members");
}
