import { PrismaClient, ClubMembershipRole } from "@prisma/client";
import { parseArgs } from "node:util";

export class ProvisionClubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisionClubError";
  }
}

export interface ProvisionClubArgs {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  prisma?: PrismaClient;
}

export interface ProvisionClubResult {
  club: { id: string; name: string; slug: string };
  user: { id: string; email: string; name: string };
  membership: { id: string; role: ClubMembershipRole };
}

export async function provisionClub(args: ProvisionClubArgs): Promise<ProvisionClubResult> {
  const prisma = args.prisma ?? new PrismaClient();
  const ownedPrisma = !args.prisma;

  try {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) {
      throw new ProvisionClubError(
        `Invalid slug "${args.slug}" — must be lowercase alphanumeric with optional hyphens, starting with a letter or digit`
      );
    }

    const existing = await prisma.club.findUnique({ where: { slug: args.slug } });
    if (existing) throw new ProvisionClubError(`Club with slug "${args.slug}" already exists`);

    const existingUser = await prisma.user.findUnique({
      where: { email: args.ownerEmail },
      include: { memberships: { where: { status: "ACTIVE" } } },
    });
    if (existingUser && existingUser.memberships.length > 0) {
      throw new ProvisionClubError(
        `User ${args.ownerEmail} already has an active membership. Use add-member.ts to add them to additional clubs.`
      );
    }

    return await prisma.$transaction(async (tx) => {
      const club = await tx.club.create({
        data: { name: args.name, slug: args.slug },
      });
      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: { clubId: club.id, name: args.ownerName, status: "ACTIVE" },
          })
        : await tx.user.create({
            data: {
              email: args.ownerEmail,
              name: args.ownerName,
              role: "CASHIER",
              status: "ACTIVE",
              clubId: club.id,
            },
          });
      const membership = await tx.clubMembership.create({
        data: { userId: user.id, clubId: club.id, role: ClubMembershipRole.OWNER, status: "ACTIVE" },
      });
      await tx.systemSettings.create({ data: { clubId: club.id } });

      return {
        club: { id: club.id, name: club.name, slug: club.slug },
        user: { id: user.id, email: user.email!, name: user.name },
        membership: { id: membership.id, role: membership.role },
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
      name: { type: "string" },
      slug: { type: "string" },
      "owner-email": { type: "string" },
      "owner-name": { type: "string" },
    },
  });
  if (!values.name || !values.slug || !values["owner-email"] || !values["owner-name"]) {
    console.error("Usage: provision-club.ts --name <Name> --slug <slug> --owner-email <email> --owner-name <Name>");
    process.exit(2);
  }
  provisionClub({
    name: values.name,
    slug: values.slug,
    ownerEmail: values["owner-email"],
    ownerName: values["owner-name"],
  })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error(e instanceof ProvisionClubError ? e.message : e);
      process.exit(1);
    });
}
