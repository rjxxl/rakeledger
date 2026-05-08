import { ClubMembershipRole } from "@prisma/client";
import { parseArgs } from "node:util";
import { addMember, AddMemberError } from "@/lib/admin/members";

export { addMember, AddMemberError };
export type { AddMemberArgs, AddMemberResult } from "@/lib/admin/members";

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
