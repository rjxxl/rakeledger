import { PrismaClient, ClubMembershipRole, ClubMembershipStatus } from "@prisma/client";

export class AddMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddMemberError";
  }
}

export interface AddMemberArgs {
  clubSlug: string;
  email: string;
  name: string;
  role: ClubMembershipRole;
  prisma?: PrismaClient;
}

export interface AddMemberResult {
  user: { id: string; email: string; name: string };
  membership: { id: string; role: ClubMembershipRole };
  /** True if a new User row was created; false if an existing User was reused. */
  created: boolean;
}

export async function addMember(args: AddMemberArgs): Promise<AddMemberResult> {
  const prisma = args.prisma ?? new PrismaClient();
  const ownedPrisma = !args.prisma;

  try {
    const club = await prisma.club.findUnique({ where: { slug: args.clubSlug } });
    if (!club) throw new AddMemberError(`No club with slug "${args.clubSlug}"`);

    return await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email: args.email } });
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email: args.email,
            name: args.name,
            role: "CASHIER",
            status: "ACTIVE",
            clubId: club.id,
          },
        }));

      const existingMembership = await tx.clubMembership.findUnique({
        where: { userId_clubId: { userId: user.id, clubId: club.id } },
      });
      if (existingMembership && existingMembership.status === "ACTIVE") {
        throw new AddMemberError(`${args.email} is already an active member of "${club.name}"`);
      }

      const membership = existingMembership
        ? await tx.clubMembership.update({
            where: { id: existingMembership.id },
            data: { role: args.role, status: "ACTIVE" },
          })
        : await tx.clubMembership.create({
            data: { userId: user.id, clubId: club.id, role: args.role, status: "ACTIVE" },
          });

      return {
        user: { id: user.id, email: user.email!, name: user.name },
        membership: { id: membership.id, role: membership.role },
        created: !existingUser,
      };
    });
  } finally {
    if (ownedPrisma) await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateMember
// ─────────────────────────────────────────────────────────────────────────────

export class UpdateMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateMemberError";
  }
}

export interface UpdateMemberArgs {
  membershipId: string;
  name: string;
  role: ClubMembershipRole;
  prisma?: PrismaClient;
}

export interface UpdateMemberResult {
  user: { id: string; email: string; name: string };
  membership: { id: string; role: ClubMembershipRole };
}

export async function updateMember(args: UpdateMemberArgs): Promise<UpdateMemberResult> {
  const prisma = args.prisma ?? new PrismaClient();
  const ownedPrisma = !args.prisma;
  try {
    return await prisma.$transaction(async (tx) => {
      const m = await tx.clubMembership.findUnique({
        where: { id: args.membershipId },
        include: { user: true, club: true },
      });
      if (!m) throw new UpdateMemberError(`No membership with id "${args.membershipId}"`);

      // Last-OWNER protection on demote.
      if (m.role === "OWNER" && args.role !== "OWNER") {
        const otherOwners = await tx.clubMembership.count({
          where: { clubId: m.clubId, role: "OWNER", status: "ACTIVE", id: { not: m.id } },
        });
        if (otherOwners === 0) {
          throw new UpdateMemberError(
            `Cannot demote the last ACTIVE OWNER of "${m.club.name}". Promote another OWNER first.`
          );
        }
      }

      const updatedMembership = await tx.clubMembership.update({
        where: { id: m.id },
        data: { role: args.role },
      });
      const updatedUser = await tx.user.update({
        where: { id: m.userId },
        data: { name: args.name },
      });
      return {
        user: { id: updatedUser.id, email: updatedUser.email!, name: updatedUser.name },
        membership: { id: updatedMembership.id, role: updatedMembership.role },
      };
    });
  } finally {
    if (ownedPrisma) await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// revokeMember
// ─────────────────────────────────────────────────────────────────────────────

export class RevokeMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevokeMemberError";
  }
}

export interface RevokeMemberArgs {
  membershipId: string;
  prisma?: PrismaClient;
}

export async function revokeMember(args: RevokeMemberArgs): Promise<void> {
  const prisma = args.prisma ?? new PrismaClient();
  const ownedPrisma = !args.prisma;
  try {
    await prisma.$transaction(async (tx) => {
      const m = await tx.clubMembership.findUnique({
        where: { id: args.membershipId },
        include: { club: true },
      });
      if (!m) throw new RevokeMemberError(`No membership with id "${args.membershipId}"`);
      if (m.status === "REMOVED") {
        throw new RevokeMemberError(`Membership is already REMOVED`);
      }

      // Last-OWNER protection on revoke.
      if (m.role === "OWNER") {
        const otherOwners = await tx.clubMembership.count({
          where: { clubId: m.clubId, role: "OWNER", status: "ACTIVE", id: { not: m.id } },
        });
        if (otherOwners === 0) {
          throw new RevokeMemberError(
            `Cannot revoke the last ACTIVE OWNER of "${m.club.name}". Promote another OWNER first.`
          );
        }
      }

      await tx.clubMembership.update({
        where: { id: m.id },
        data: { status: "REMOVED" },
      });
    });
  } finally {
    if (ownedPrisma) await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// reAddMember
// ─────────────────────────────────────────────────────────────────────────────

export interface ReAddMemberArgs {
  membershipId: string;
  role: ClubMembershipRole;
  prisma?: PrismaClient;
}

export interface ReAddMemberResult {
  user: { id: string; email: string; name: string };
  membership: { id: string; role: ClubMembershipRole; status: ClubMembershipStatus };
}

export async function reAddMember(args: ReAddMemberArgs): Promise<ReAddMemberResult> {
  const prisma = args.prisma ?? new PrismaClient();
  const ownedPrisma = !args.prisma;
  try {
    return await prisma.$transaction(async (tx) => {
      const m = await tx.clubMembership.findUnique({
        where: { id: args.membershipId },
        include: { user: true },
      });
      if (!m) throw new AddMemberError(`No membership with id "${args.membershipId}"`);
      if (m.status === "ACTIVE") {
        throw new AddMemberError(`Membership is already ACTIVE`);
      }
      const updated = await tx.clubMembership.update({
        where: { id: m.id },
        data: { role: args.role, status: "ACTIVE" },
      });
      return {
        user: { id: m.user.id, email: m.user.email!, name: m.user.name },
        membership: { id: updated.id, role: updated.role, status: updated.status },
      };
    });
  } finally {
    if (ownedPrisma) await prisma.$disconnect();
  }
}
