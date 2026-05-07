import { PrismaClient, ClubMembershipRole } from "@prisma/client";
import { parseArgs } from "node:util";

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

// CLI entry point
if (require.main === module) {
  const { values } = parseArgs({
    options: {
      club: { type: "string" },
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
    },
  });
  if (!values.club || !values.email || !values.name || !values.role) {
    console.error("Usage: add-member.ts --club <slug> --email <email> --name <Name> --role <ROLE>");
    process.exit(2);
  }
  const validRoles: ClubMembershipRole[] = ["OWNER", "ADMIN", "CASHIER", "RUNNER"];
  if (!validRoles.includes(values.role as ClubMembershipRole)) {
    console.error(`Invalid role "${values.role}". Must be one of: ${validRoles.join(", ")}`);
    process.exit(2);
  }
  addMember({
    clubSlug: values.club,
    email: values.email,
    name: values.name,
    role: values.role as ClubMembershipRole,
  })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error(e instanceof AddMemberError ? e.message : e);
      process.exit(1);
    });
}
