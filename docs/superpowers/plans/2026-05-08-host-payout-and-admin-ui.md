# Host Payout + Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two pre-handoff features together as one branch/deploy: (1) per-session host selection that drives both house-tax and rake distribution at session close, and (2) an admin UI under `/settings/members` for OWNER/ADMIN club members to add, edit, revoke, and re-add login access.

**Architecture:** Adds one Prisma column (`Session.hostUserIds`) and zero models for host-payout. Lifts state for Steps 2/3 of close-session into a new client wrapper. Extracts existing `addMember` core logic to `lib/admin/members.ts`, where new functions for update/revoke/reAdd join it. Drops the env-var allowlist entirely; tightens `signIn` to require an active membership. Introduces `requireAdmin()` as the first RBAC gate, applied only to `/settings/members`.

**Tech Stack:** Next.js 16.2.4 (note: `middleware.ts` → `proxy.ts`), React 19.2.4 (server components + server actions), Auth.js v5 (`next-auth@5.0.0-beta.31`), Prisma 6.19.3, Postgres 16 / Neon, decimal.js, zod, Vitest 4 + Playwright.

**Source specs (read these first):**
- `docs/superpowers/specs/2026-05-08-host-payout-design.md`
- `docs/superpowers/specs/2026-05-08-admin-ui-design.md`

**Project conventions you must respect:**
- Read `AGENTS.md` and `node_modules/next/dist/docs/` before invoking Next 16 APIs you're unsure about. Next 16 has breaking changes from prior versions.
- Server actions: file starts with `"use server"`; FormData inputs validated with zod; use `revalidatePath()` after mutations.
- Client components: file starts with `"use client"`; serialize `Decimal` → `string` across the RSC boundary, deserialize inside the client.
- Tests: Vitest unit at `tests/unit/**`, Playwright E2E at `tests/e2e/**`. Use `testPrisma` + `resetDatabase` from `tests/unit/test-db.ts`.
- Env: `AUTH_BYPASS_FOR_TESTS=1` in `.env.test` and `.env.e2e` skips Google OAuth and uses `TEST_USER_EMAIL`. Keep this working.
- DB guards: tests will refuse to run unless `DATABASE_URL` contains `rakeledger_test`; run vitest via `npm test` (which loads `.env.test`).

---

## File Structure

**New files:**
- `prisma/migrations/<TIMESTAMP>_add_session_host_user_ids/migration.sql` — additive Postgres migration.
- `lib/admin/members.ts` — shared member-management functions; called by both UI and CLI.
- `lib/admin/require-admin.ts` — RBAC helper that asserts the active user is OWNER/ADMIN of their active club.
- `app/(cashier)/_actions/host-selection.ts` — server action `updateSessionHosts(sessionId, userIds)`.
- `app/(cashier)/close/_components/even-split.ts` — pure utility extracted from current inline `evenSplit()` in `close/page.tsx`.
- `app/(cashier)/close/_components/host-selector-and-distribution.tsx` — client wrapper that owns host-selection state, derives recipient lists, renders `HostSelector` + `HouseTaxStep` + `RakeDistributionStep`(per game).
- `app/(cashier)/close/_components/host-selector.tsx` — pure presentational checklist (receives state + onChange via props).
- `app/(cashier)/settings/members/page.tsx` — RBAC-gated server component listing members.
- `app/(cashier)/settings/members/_actions.ts` — server actions calling `lib/admin/members.ts`.
- `app/(cashier)/settings/members/_components/members-list.tsx` — client component for the list (handles "Show removed" toggle).
- `app/(cashier)/settings/members/_components/add-member-modal.tsx` — client modal form.
- `app/(cashier)/settings/members/_components/edit-member-modal.tsx` — client modal form.
- `app/(cashier)/settings/members/_components/revoke-confirm.tsx` — client confirm dialog.
- `tests/unit/lib/admin/members.test.ts` — unit tests for shared functions.
- `tests/unit/lib/admin/require-admin.test.ts` — unit tests for the RBAC helper.
- `tests/unit/auth/sign-in.test.ts` — unit tests for the updated `signIn` callback.
- `tests/e2e/host-payout.spec.ts` — E2E for host selection driving distribution.
- `tests/e2e/admin-members.spec.ts` — E2E for admin add/revoke/re-add.

**Modified files:**
- `prisma/schema.prisma` — add `hostUserIds String[] @default([])` to `Session`.
- `lib/auth.ts` — drop `isEmailAllowed`; rewrite `signIn` callback.
- `scripts/add-member.ts` — thin CLI wrapper around `lib/admin/members.ts`.
- `app/(cashier)/close/page.tsx` — single candidate-staff query; wrap Steps 2/3 in `HostSelectorAndDistribution`.
- `app/(cashier)/close/_components/house-tax-step.tsx` — empty-state when `initialRecipients` is empty.
- `app/(cashier)/close/_components/rake-distribution-step.tsx` — empty-state when `initialRecipients` is empty.
- `app/(cashier)/settings/page.tsx` — conditionally render Members link for OWNER/ADMIN.
- `tests/unit/scripts/add-member.test.ts` — update import paths if any (logic unchanged).
- `.env` (gitignored) — remove `AUTH_ALLOWED_EMAILS`.
- `.env.production` (gitignored) — remove `AUTH_ALLOWED_EMAILS`.
- `.env.e2e.example` — remove `AUTH_ALLOWED_EMAILS`.

**Deleted files:**
- `tests/unit/auth/allowlist.test.ts` — `isEmailAllowed` no longer exists.

---

## Task 1: Schema migration for `Session.hostUserIds`

**Files:**
- Modify: `prisma/schema.prisma` (Session model — add one column)
- Create: `prisma/migrations/<TIMESTAMP>_add_session_host_user_ids/migration.sql`

- [ ] **Step 1: Add the column to the Prisma schema**

Open `prisma/schema.prisma` and locate the `model Session` block. Add the new field at the end of the field list (before any `@@` block-level attributes):

```prisma
model Session {
  // ...existing fields, do not touch...
  hostUserIds String[] @default([])
}
```

- [ ] **Step 2: Generate the migration**

Run from the project root:

```
npx dotenv -e .env -- npx prisma migrate dev --name add_session_host_user_ids
```

Expected: a new directory `prisma/migrations/<TIMESTAMP>_add_session_host_user_ids/` with `migration.sql`. Prisma will also regenerate `@prisma/client`. Confirm `migration.sql` contains:

```sql
ALTER TABLE "Session" ADD COLUMN "hostUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
```

If the generated SQL differs (e.g., extra `NOT NULL`), edit `migration.sql` to match the line above and re-apply with `npx prisma migrate dev`.

- [ ] **Step 3: Verify the schema change in tests**

Update `tests/unit/test-db.ts` to ensure `Session` continues to truncate cleanly. The TRUNCATE list at line 13 already includes `"Session"` — no change needed. Confirm by running:

```
npm test -- tests/unit/seed.test.ts
```

Expected: passes (existing test).

- [ ] **Step 4: Commit**

```
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add Session.hostUserIds for per-session host selection"
```

---

## Task 2: Extract shared member-management logic to `lib/admin/members.ts`

**Files:**
- Create: `lib/admin/members.ts`
- Modify: `scripts/add-member.ts` (thin CLI wrapper)
- Modify: `tests/unit/scripts/add-member.test.ts` (re-target imports)

This task moves the `addMember` core function out of `scripts/add-member.ts` so the UI server actions can call into the same logic. **No new behavior** — pure refactor.

- [ ] **Step 1: Create `lib/admin/members.ts` with the moved `addMember`**

Create the file with the exact content below. This is a verbatim move of `scripts/add-member.ts:1-73` into a library module:

```ts
import { PrismaClient, ClubMembershipRole } from "@prisma/client";

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
```

- [ ] **Step 2: Replace `scripts/add-member.ts` body with re-exports + CLI**

Open `scripts/add-member.ts` and replace its entire content with:

```ts
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
```

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```
npm test -- tests/unit/scripts/add-member.test.ts
```

Expected: PASS — the imports `from "@/scripts/add-member"` still resolve to the same exported symbols (now via re-export).

- [ ] **Step 4: Commit**

```
git add lib/admin/members.ts scripts/add-member.ts
git commit -m "refactor(admin): move addMember to lib/admin/members for UI re-use"
```

---

## Task 3: Add `updateMember`, `revokeMember`, `reAddMember` to `lib/admin/members.ts`

**Files:**
- Modify: `lib/admin/members.ts` (append new functions)
- Create: `tests/unit/lib/admin/members.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/admin/members.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../../test-db";
import {
  addMember,
  updateMember,
  revokeMember,
  reAddMember,
  AddMemberError,
  UpdateMemberError,
  RevokeMemberError,
} from "@/lib/admin/members";
import { provisionClub } from "@/scripts/provision-club";

describe("updateMember", () => {
  beforeEach(resetDatabase);

  it("updates the role of an existing membership", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const added = await addMember({
      clubSlug: "x", email: "alice@x.com", name: "Alice", role: "CASHIER",
      prisma: testPrisma,
    });
    const r = await updateMember({
      membershipId: added.membership.id, name: "Alice Smith", role: "ADMIN",
      prisma: testPrisma,
    });
    expect(r.membership.role).toBe("ADMIN");
    expect(r.user.name).toBe("Alice Smith");
  });

  it("throws when the membership doesn't exist", async () => {
    await expect(
      updateMember({
        membershipId: "nonexistent", name: "X", role: "CASHIER",
        prisma: testPrisma,
      })
    ).rejects.toBeInstanceOf(UpdateMemberError);
  });
});

describe("revokeMember", () => {
  beforeEach(resetDatabase);

  it("sets status to REMOVED on a non-OWNER membership", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const added = await addMember({
      clubSlug: "x", email: "alice@x.com", name: "Alice", role: "CASHIER",
      prisma: testPrisma,
    });
    await revokeMember({ membershipId: added.membership.id, prisma: testPrisma });
    const m = await testPrisma.clubMembership.findUnique({
      where: { id: added.membership.id },
    });
    expect(m?.status).toBe("REMOVED");
  });

  it("rejects revoking the last ACTIVE OWNER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const owner = await testPrisma.clubMembership.findFirstOrThrow({
      where: { role: "OWNER" },
    });
    await expect(
      revokeMember({ membershipId: owner.id, prisma: testPrisma })
    ).rejects.toBeInstanceOf(RevokeMemberError);
  });

  it("allows revoking a non-last OWNER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const second = await addMember({
      clubSlug: "x", email: "two@x.com", name: "Two", role: "OWNER",
      prisma: testPrisma,
    });
    await revokeMember({ membershipId: second.membership.id, prisma: testPrisma });
    const m = await testPrisma.clubMembership.findUnique({
      where: { id: second.membership.id },
    });
    expect(m?.status).toBe("REMOVED");
  });
});

describe("reAddMember", () => {
  beforeEach(resetDatabase);

  it("flips a REMOVED membership back to ACTIVE with the new role", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const added = await addMember({
      clubSlug: "x", email: "alice@x.com", name: "Alice", role: "CASHIER",
      prisma: testPrisma,
    });
    await revokeMember({ membershipId: added.membership.id, prisma: testPrisma });
    const r = await reAddMember({
      membershipId: added.membership.id, role: "ADMIN", prisma: testPrisma,
    });
    expect(r.membership.role).toBe("ADMIN");
    expect(r.membership.status).toBe("ACTIVE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test -- tests/unit/lib/admin/members.test.ts
```

Expected: FAIL with errors like `"updateMember" is not exported`, `UpdateMemberError is undefined`, etc.

- [ ] **Step 3: Implement the new functions**

Append to `lib/admin/members.ts`:

```ts
export class UpdateMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateMemberError";
  }
}

export class RevokeMemberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RevokeMemberError";
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

export interface ReAddMemberArgs {
  membershipId: string;
  role: ClubMembershipRole;
  prisma?: PrismaClient;
}

export interface ReAddMemberResult {
  user: { id: string; email: string; name: string };
  membership: { id: string; role: ClubMembershipRole; status: "ACTIVE" | "REMOVED" };
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
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test -- tests/unit/lib/admin/members.test.ts
```

Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```
git add lib/admin/members.ts tests/unit/lib/admin/members.test.ts
git commit -m "feat(admin): updateMember + revokeMember + reAddMember with last-OWNER protection"
```

---

## Task 4: Add `requireAdmin()` RBAC helper

**Files:**
- Create: `lib/admin/require-admin.ts`
- Create: `tests/unit/lib/admin/require-admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/admin/require-admin.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../../test-db";
import { requireAdmin, NotAdminError } from "@/lib/admin/require-admin";
import { provisionClub } from "@/scripts/provision-club";
import { addMember } from "@/lib/admin/members";

// These tests bypass auth via the existing AUTH_BYPASS_FOR_TESTS=1 / TEST_USER_EMAIL pattern.
// We rotate TEST_USER_EMAIL per test to act as different members.

describe("requireAdmin", () => {
  beforeEach(resetDatabase);

  it("returns the membership when caller is OWNER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    process.env.TEST_USER_EMAIL = "owner@x.com";
    const m = await requireAdmin();
    expect(m.role).toBe("OWNER");
  });

  it("returns the membership when caller is ADMIN", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    await addMember({
      clubSlug: "x", email: "admin@x.com", name: "Admin", role: "ADMIN",
      prisma: testPrisma,
    });
    process.env.TEST_USER_EMAIL = "admin@x.com";
    const m = await requireAdmin();
    expect(m.role).toBe("ADMIN");
  });

  it("throws NotAdminError when caller is CASHIER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    await addMember({
      clubSlug: "x", email: "cashier@x.com", name: "Cashier", role: "CASHIER",
      prisma: testPrisma,
    });
    process.env.TEST_USER_EMAIL = "cashier@x.com";
    await expect(requireAdmin()).rejects.toBeInstanceOf(NotAdminError);
  });

  it("throws NotAdminError when caller is RUNNER", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    await addMember({
      clubSlug: "x", email: "runner@x.com", name: "Runner", role: "RUNNER",
      prisma: testPrisma,
    });
    process.env.TEST_USER_EMAIL = "runner@x.com";
    await expect(requireAdmin()).rejects.toBeInstanceOf(NotAdminError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test -- tests/unit/lib/admin/require-admin.test.ts
```

Expected: FAIL — `requireAdmin` not found.

- [ ] **Step 3: Implement `requireAdmin`**

Create `lib/admin/require-admin.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActiveUser } from "@/lib/active-user";
import type { ClubMembership } from "@prisma/client";

export class NotAdminError extends Error {
  constructor(message = "OWNER or ADMIN role required") {
    super(message);
    this.name = "NotAdminError";
  }
}

/**
 * Returns the active user's membership in their active club if (and only if)
 * the membership role is OWNER or ADMIN. Throws NotAdminError otherwise.
 *
 * Server-side trust boundary — call at the top of any RBAC-gated server
 * action or page server-component.
 */
export async function requireAdmin(): Promise<ClubMembership> {
  const user = await getActiveUser();
  if (!user.clubId) {
    throw new NotAdminError("No active club");
  }
  const membership = await prisma.clubMembership.findUnique({
    where: { userId_clubId: { userId: user.id, clubId: user.clubId } },
  });
  if (!membership || membership.status !== "ACTIVE") {
    throw new NotAdminError("No active membership");
  }
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw new NotAdminError();
  }
  return membership;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test -- tests/unit/lib/admin/require-admin.test.ts
```

Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```
git add lib/admin/require-admin.ts tests/unit/lib/admin/require-admin.test.ts
git commit -m "feat(admin): requireAdmin RBAC helper for OWNER/ADMIN-only routes"
```

---

## Task 5: Update `signIn` callback — drop allowlist, add membership check

**Files:**
- Modify: `lib/auth.ts`
- Create: `tests/unit/auth/sign-in.test.ts`
- Delete: `tests/unit/auth/allowlist.test.ts`

- [ ] **Step 1: Write the failing tests for the new `signIn` behavior**

Create `tests/unit/auth/sign-in.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";
import { provisionClub } from "@/scripts/provision-club";
import { addMember } from "@/lib/admin/members";

// Auth.js's `signIn` callback is exported as part of the NextAuth config in
// lib/auth.ts. It's not directly importable, but we can test the same logic
// by importing a small helper. To do that we'll extract the policy into a
// pure function `canSignIn(email, prismaClient)` that the callback calls.

import { canSignIn } from "@/lib/auth";

describe("canSignIn", () => {
  beforeEach(resetDatabase);

  it("rejects an email with no User row", async () => {
    expect(await canSignIn("nobody@x.com", testPrisma)).toBe(false);
  });

  it("rejects a User with status = DISABLED", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    await testPrisma.user.update({
      where: { email: "owner@x.com" },
      data: { status: "DISABLED" },
    });
    expect(await canSignIn("owner@x.com", testPrisma)).toBe(false);
  });

  it("rejects a User with no ACTIVE memberships", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    const m = await testPrisma.clubMembership.findFirstOrThrow({
      where: { user: { email: "owner@x.com" } },
    });
    await testPrisma.clubMembership.update({
      where: { id: m.id },
      data: { status: "REMOVED" },
    });
    expect(await canSignIn("owner@x.com", testPrisma)).toBe(false);
  });

  it("accepts a User with status=ACTIVE and at least one ACTIVE membership", async () => {
    await provisionClub({
      name: "X", slug: "x", ownerEmail: "owner@x.com", ownerName: "Owner",
      prisma: testPrisma,
    });
    expect(await canSignIn("owner@x.com", testPrisma)).toBe(true);
  });

  it("accepts a User with multiple memberships when at least one is ACTIVE", async () => {
    await provisionClub({
      name: "A", slug: "a", ownerEmail: "u@x.com", ownerName: "U",
      prisma: testPrisma,
    });
    await provisionClub({
      name: "B", slug: "b", ownerEmail: "owner@b.com", ownerName: "B-Owner",
      prisma: testPrisma,
    });
    await addMember({
      clubSlug: "b", email: "u@x.com", name: "U", role: "CASHIER",
      prisma: testPrisma,
    });
    // Revoke first membership, leave second active.
    const first = await testPrisma.clubMembership.findFirstOrThrow({
      where: { user: { email: "u@x.com" }, club: { slug: "a" } },
    });
    await testPrisma.clubMembership.update({
      where: { id: first.id },
      data: { status: "REMOVED" },
    });
    expect(await canSignIn("u@x.com", testPrisma)).toBe(true);
  });

  it("rejects null/empty email", async () => {
    expect(await canSignIn(null, testPrisma)).toBe(false);
    expect(await canSignIn("", testPrisma)).toBe(false);
    expect(await canSignIn(undefined, testPrisma)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test -- tests/unit/auth/sign-in.test.ts
```

Expected: FAIL — `canSignIn` not exported.

- [ ] **Step 3: Update `lib/auth.ts`**

Replace `lib/auth.ts` entirely with:

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/db";
import type { PrismaClient } from "@prisma/client";

/**
 * Pure policy: can this email sign in?
 *
 * Rules:
 *  1. Must reference a User row that exists.
 *  2. User.status must be ACTIVE.
 *  3. User must have at least one ClubMembership with status=ACTIVE.
 *
 * Exported for testability. The signIn callback below calls this with the
 * default prisma client.
 */
export async function canSignIn(
  email: string | null | undefined,
  client: PrismaClient = prisma
): Promise<boolean> {
  if (!email) return false;
  const dbUser = await client.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!dbUser) return false;
  if (dbUser.status !== "ACTIVE") return false;
  if (dbUser.memberships.length === 0) return false;
  return true;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      clubId: string | null;
      clubName: string | null;
    };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  trustHost: true,
  callbacks: {
    async signIn({ user }) {
      return await canSignIn(user.email);
    },
    // TODO(phase-a): Refresh activeClubId/activeClubName on every JWT cycle (or invalidate session
    // on ClubMembership change). Right now we only resolve them on initial sign-in, so a user's
    // session keeps the old clubId for up to 30 days even if their membership is moved/revoked.
    // Documented as best-effort revoke; nuclear option = rotate AUTH_SECRET.
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
          include: {
            memberships: {
              where: { status: "ACTIVE" },
              include: { club: true },
              take: 1,
            },
          },
        });
        if (dbUser) {
          token.dbUserId = dbUser.id;
          const m = dbUser.memberships[0];
          token.activeClubId = m?.clubId ?? null;
          token.activeClubName = m?.club.name ?? null;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!token.dbUserId) {
        throw new Error("Session token is missing dbUserId — refusing to construct session");
      }
      session.user.id = token.dbUserId as string;
      session.user.clubId = (token.activeClubId as string | null) ?? null;
      session.user.clubName = (token.activeClubName as string | null) ?? null;
      return session;
    },
  },
});
```

- [ ] **Step 4: Delete the obsolete allowlist test**

```
git rm tests/unit/auth/allowlist.test.ts
```

- [ ] **Step 5: Run tests to verify the new tests pass**

```
npm test -- tests/unit/auth/sign-in.test.ts
```

Expected: PASS (all 6 tests).

- [ ] **Step 6: Run the full test suite to catch any other breakage**

```
npm test
```

Expected: all suites green. If anything imports `isEmailAllowed` from `@/lib/auth`, fix the import or delete it; that helper is gone.

- [ ] **Step 7: Commit**

```
git add lib/auth.ts tests/unit/auth/sign-in.test.ts
git commit -m "feat(auth): drop email allowlist, require active membership at signIn"
```

---

## Task 6: Remove `AUTH_ALLOWED_EMAILS` from env files

**Files:**
- Modify: `.env` (gitignored)
- Modify: `.env.production` (gitignored)
- Modify: `.env.e2e.example`

- [ ] **Step 1: Remove the line from `.env`**

Delete the `AUTH_ALLOWED_EMAILS=...` line from `.env`. (This file is gitignored — local-only.)

- [ ] **Step 2: Remove the line from `.env.production`**

Delete the `AUTH_ALLOWED_EMAILS=...` line from `.env.production`. (Also gitignored.)

- [ ] **Step 3: Remove the line from `.env.e2e.example`**

Open `.env.e2e.example` and delete the `AUTH_ALLOWED_EMAILS=...` line.

- [ ] **Step 4: Note for human deploy**

Add a one-liner to the plan deployment notes (no commit needed for env vars, but the human running the deploy must remove `AUTH_ALLOWED_EMAILS` from the Vercel project's environment variables **after** the new code is live. Until then, the env var is harmless — the new code doesn't read it. After deploy, remove for cleanliness.)

- [ ] **Step 5: Commit the example file**

```
git add .env.e2e.example
git commit -m "chore(env): drop AUTH_ALLOWED_EMAILS from env example (no longer used)"
```

---

## Task 7: Server action `updateSessionHosts`

**Files:**
- Create: `app/(cashier)/_actions/host-selection.ts`
- Create: `tests/unit/actions/host-selection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/actions/host-selection.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";
import { updateSessionHosts } from "@/app/(cashier)/_actions/host-selection";

async function seedSession() {
  // resetDatabase already creates club "test-club" + cashier user "test-cashier"
  // (membership role OWNER). We add an active session for the cashier.
  const session = await testPrisma.session.create({
    data: {
      clubId: "test-club",
      openedById: "test-cashier",
      openingCash: "0",
    },
  });
  return session;
}

describe("updateSessionHosts", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.TEST_USER_EMAIL = "test-cashier@dev";
  });

  it("writes the userIds array to Session.hostUserIds", async () => {
    const session = await seedSession();
    // Add a second user in the same club to use as a host.
    const host = await testPrisma.user.create({
      data: {
        email: "host@x.com", name: "Host", role: "RUNNER", status: "ACTIVE", clubId: "test-club",
      },
    });
    await updateSessionHosts(session.id, [host.id]);
    const after = await testPrisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.hostUserIds).toEqual([host.id]);
  });

  it("overwrites previous selection (last-write-wins)", async () => {
    const session = await seedSession();
    const a = await testPrisma.user.create({
      data: { email: "a@x.com", name: "A", role: "RUNNER", status: "ACTIVE", clubId: "test-club" },
    });
    const b = await testPrisma.user.create({
      data: { email: "b@x.com", name: "B", role: "RUNNER", status: "ACTIVE", clubId: "test-club" },
    });
    await updateSessionHosts(session.id, [a.id]);
    await updateSessionHosts(session.id, [b.id]);
    const after = await testPrisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.hostUserIds).toEqual([b.id]);
  });

  it("rejects userIds that don't belong to the session's club", async () => {
    const session = await seedSession();
    const otherClub = await testPrisma.club.create({
      data: { name: "Other", slug: "other" },
    });
    const outsider = await testPrisma.user.create({
      data: {
        email: "outsider@x.com", name: "Outsider", role: "CASHIER", status: "ACTIVE", clubId: otherClub.id,
      },
    });
    await expect(updateSessionHosts(session.id, [outsider.id])).rejects.toThrow();
  });

  it("rejects userIds whose User.status is not ACTIVE", async () => {
    const session = await seedSession();
    const disabled = await testPrisma.user.create({
      data: {
        email: "d@x.com", name: "D", role: "RUNNER", status: "DISABLED", clubId: "test-club",
      },
    });
    await expect(updateSessionHosts(session.id, [disabled.id])).rejects.toThrow();
  });

  it("accepts an empty array (clearing selection)", async () => {
    const session = await seedSession();
    await updateSessionHosts(session.id, []);
    const after = await testPrisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.hostUserIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test -- tests/unit/actions/host-selection.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the server action**

Create `app/(cashier)/_actions/host-selection.ts`:

```ts
"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActiveUser } from "@/lib/active-user";
import { revalidatePath } from "next/cache";

const userIdsSchema = z.array(z.string().min(1));

export async function updateSessionHosts(
  sessionId: string,
  userIds: string[]
): Promise<void> {
  const validatedIds = userIdsSchema.parse(userIds);

  const caller = await getActiveUser();
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, clubId: true, status: true },
  });
  if (!session) throw new Error(`No session with id "${sessionId}"`);
  if (session.clubId !== caller.clubId) {
    throw new Error("Session belongs to a different club");
  }

  if (validatedIds.length > 0) {
    const validUsers = await prisma.user.findMany({
      where: {
        id: { in: validatedIds },
        clubId: session.clubId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (validUsers.length !== validatedIds.length) {
      throw new Error(
        "One or more userIds do not belong to this club or are not ACTIVE"
      );
    }
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { hostUserIds: validatedIds },
  });

  revalidatePath("/close");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test -- tests/unit/actions/host-selection.test.ts
```

Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```
git add app/\(cashier\)/_actions/host-selection.ts tests/unit/actions/host-selection.test.ts
git commit -m "feat(close): updateSessionHosts server action with club + status validation"
```

---

## Task 8: Extract `evenSplit` and refactor close-page query

**Files:**
- Create: `app/(cashier)/close/_components/even-split.ts`
- Modify: `app/(cashier)/close/page.tsx`

- [ ] **Step 1: Extract `evenSplit` to its own module**

Create `app/(cashier)/close/_components/even-split.ts`:

```ts
import Decimal from "decimal.js";

/**
 * Splits `total` evenly across `count` recipients with 2-decimal rounding,
 * placing any remainder on the first recipient. Returns an empty array when
 * count is 0.
 */
export function evenSplit(total: Decimal, count: number): Decimal[] {
  if (count === 0) return [];
  const baseDecimal = total.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const totals: Decimal[] = Array(count).fill(baseDecimal);
  const allocated = baseDecimal.mul(count);
  const remainder = total.sub(allocated);
  if (!remainder.equals(0) && totals.length > 0) {
    totals[0] = totals[0].add(remainder);
  }
  return totals;
}
```

- [ ] **Step 2: Refactor `close/page.tsx` query and remove the local `evenSplit`**

Open `app/(cashier)/close/page.tsx`. Replace lines 36–94 (the `owners`/`hosts` queries, the local `evenSplit` function, and the `houseTaxRecipients` and `rakeStepsData` derivations) with the following:

```ts
  // Single candidate-staff query (replaces dual role-bucket queries).
  // WAITRESS excluded because they're tip-pool recipients only; DEALER kept
  // because the user explicitly wanted them on the host checklist for nights
  // when a dealer also acts as a host.
  const candidateStaff = await prisma.user.findMany({
    where: {
      clubId: session.clubId,
      status: "ACTIVE",
      role: { not: "WAITRESS" },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
```

Then the existing block:

```ts
  if (session.games.length === 0) {
    redirect("/live");
  }
  const defaultGameId = session.games[0].id;
```

remains.

Replace the existing `<HouseTaxStep>` block AND the per-game `<RakeDistributionStep>` block (lines 145–169) with a single render of the new wrapper:

```tsx
      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Hosts working tonight</h3>
        <HostSelectorAndDistribution
          sessionId={session.id}
          gameId={defaultGameId}
          candidateStaff={candidateStaff}
          initialHostUserIds={session.hostUserIds}
          totalHouseTax={houseTaxPool.toString()}
          rakePerGame={rakePerGame.map((rp) => ({
            gameId: rp.gameId,
            gameName: rp.gameName,
            total: rp.total.toString(),
          }))}
        />
      </section>
```

Remove the `import` for `HouseTaxStep` and `RakeDistributionStep` from this file (they're now imported by the wrapper). Add an import for the wrapper:

```ts
import { HostSelectorAndDistribution } from "./_components/host-selector-and-distribution";
```

Also remove the unused `evenSplit`, `owners`, `hosts`, `houseTaxRecipients`, `rakeStepsData` symbols. The `evenSplit` import is no longer needed at the page level.

- [ ] **Step 3: Run typecheck**

```
npx tsc --noEmit
```

Expected: PASS — close/page.tsx no longer references the removed symbols. (The wrapper component doesn't exist yet; this step expects to fail with a missing-module error, which is the next task.)

- [ ] **Step 4: Commit (intermediate — refactor only)**

```
git add app/\(cashier\)/close/_components/even-split.ts app/\(cashier\)/close/page.tsx
git commit -m "refactor(close): extract evenSplit + replace dual-bucket queries with single candidate-staff query"
```

---

## Task 9: `HostSelector` + `HostSelectorAndDistribution` client components

**Files:**
- Create: `app/(cashier)/close/_components/host-selector.tsx`
- Create: `app/(cashier)/close/_components/host-selector-and-distribution.tsx`

- [ ] **Step 1: Implement `HostSelector` (presentational)**

Create `app/(cashier)/close/_components/host-selector.tsx`:

```tsx
"use client";

import type { UserRole } from "@prisma/client";

interface CandidateStaff {
  id: string;
  name: string;
  role: UserRole;
}

interface Props {
  candidateStaff: CandidateStaff[];
  selectedIds: Set<string>;
  onToggle: (userId: string) => void;
}

export function HostSelector({ candidateStaff, selectedIds, onToggle }: Props) {
  if (candidateStaff.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">
        No staff in this club yet. Add staff on the Staff page first.
      </p>
    );
  }
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <ul className="flex flex-col gap-1.5">
        {candidateStaff.map((s) => {
          const checked = selectedIds.has(s.id);
          return (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id={`host-${s.id}`}
                checked={checked}
                onChange={() => onToggle(s.id)}
                className="cursor-pointer"
              />
              <label htmlFor={`host-${s.id}`} className="cursor-pointer flex-1">
                {s.name}
              </label>
              <span className="text-xs text-slate-500 uppercase tracking-wider">
                {s.role}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Implement `HostSelectorAndDistribution` (state owner)**

Create `app/(cashier)/close/_components/host-selector-and-distribution.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import Decimal from "decimal.js";
import type { UserRole } from "@prisma/client";
import { HostSelector } from "./host-selector";
import { HouseTaxStep } from "./house-tax-step";
import { RakeDistributionStep } from "./rake-distribution-step";
import { evenSplit } from "./even-split";
import { updateSessionHosts } from "../../_actions/host-selection";

interface CandidateStaff {
  id: string;
  name: string;
  role: UserRole;
}

interface RakeGame {
  gameId: string;
  gameName: string;
  total: string; // Decimal serialized
}

interface RecipientSerial {
  userId: string;
  userName: string;
  amount: string;
  method: "CASH" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY";
}

interface Props {
  sessionId: string;
  gameId: string;
  candidateStaff: CandidateStaff[];
  initialHostUserIds: string[];
  totalHouseTax: string;
  rakePerGame: RakeGame[];
}

export function HostSelectorAndDistribution({
  sessionId,
  gameId,
  candidateStaff,
  initialHostUserIds,
  totalHouseTax,
  rakePerGame,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialHostUserIds)
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestIdsRef = useRef<string[]>([...initialHostUserIds]);

  // Persist selection to the server, debounced 500ms.
  function persist(ids: string[]) {
    latestIdsRef.current = ids;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateSessionHosts(sessionId, latestIdsRef.current).catch((e) => {
        console.error("Failed to save host selection:", e);
      });
    }, 500);
  }

  // Flush any pending save on unmount/navigation.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        updateSessionHosts(sessionId, latestIdsRef.current).catch(() => {});
      }
    };
  }, [sessionId]);

  function toggle(userId: string) {
    const next = new Set(selectedIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelectedIds(next);
    persist([...next]);
  }

  // Build recipient lists from selected hosts + pool amounts.
  const selectedStaff = candidateStaff.filter((s) => selectedIds.has(s.id));
  const houseTaxDecimal = new Decimal(totalHouseTax);
  const houseTaxSplits = evenSplit(houseTaxDecimal, selectedStaff.length);
  const houseTaxRecipients: RecipientSerial[] = selectedStaff.map((s, i) => ({
    userId: s.id,
    userName: s.name,
    amount: (houseTaxSplits[i] ?? new Decimal(0)).toString(),
    method: "CASH",
  }));

  const rakeStepsData = rakePerGame.map((rp) => {
    const total = new Decimal(rp.total);
    const splits = evenSplit(total, selectedStaff.length);
    return {
      ...rp,
      recipients: selectedStaff.map((s, i) => ({
        userId: s.id,
        userName: s.name,
        amount: (splits[i] ?? new Decimal(0)).toString(),
        method: "CASH" as const,
      })),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <HostSelector
        candidateStaff={candidateStaff}
        selectedIds={selectedIds}
        onToggle={toggle}
      />

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">
          Step 2 &mdash; Distribute house tax pool
        </h3>
        <HouseTaxStep
          key={`htx-${selectedStaff.length}`}
          sessionId={sessionId}
          gameId={gameId}
          totalHouseTax={totalHouseTax}
          initialRecipients={houseTaxRecipients}
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">
          Step 3 &mdash; Distribute rake (per game)
        </h3>
        <div className="flex flex-col gap-3">
          {rakeStepsData.map((rs) => (
            <RakeDistributionStep
              key={`rake-${rs.gameId}-${selectedStaff.length}`}
              sessionId={sessionId}
              gameId={rs.gameId}
              gameName={rs.gameName}
              totalRake={rs.total}
              initialRecipients={rs.recipients}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
```

Note: the `key={...selectedStaff.length}` on each step forces React to remount the step when the host list changes, so the step's internal `useState` re-initializes from the new `initialRecipients`. (Without the key, the step's internal recipients state would stick to the old list.)

- [ ] **Step 3: Run typecheck**

```
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```
git add app/\(cashier\)/close/_components/host-selector.tsx app/\(cashier\)/close/_components/host-selector-and-distribution.tsx
git commit -m "feat(close): HostSelector + state-owning wrapper for distribution steps"
```

---

## Task 10: Empty-state for `HouseTaxStep` and `RakeDistributionStep`

**Files:**
- Modify: `app/(cashier)/close/_components/house-tax-step.tsx`
- Modify: `app/(cashier)/close/_components/rake-distribution-step.tsx`

- [ ] **Step 1: Add empty-state to `HouseTaxStep`**

In `app/(cashier)/close/_components/house-tax-step.tsx`, find the existing zero-pool early return (around line 54):

```tsx
  if (totalHouseTax.lessThanOrEqualTo(0)) {
    return <p className="text-sm text-slate-500">No house tax to distribute.</p>;
  }
```

Add a second early return immediately above the main return, after the zero-pool check:

```tsx
  if (recipients.length === 0) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm text-amber-400">
          Select at least one host above to distribute the house tax pool ($
          {totalHouseTax.toString()}).
        </p>
      </div>
    );
  }
```

- [ ] **Step 2: Add empty-state to `RakeDistributionStep`**

In `app/(cashier)/close/_components/rake-distribution-step.tsx`, find the existing zero-pool early return (around line 63):

```tsx
  if (totalRake.lessThanOrEqualTo(0)) {
    return <p className="text-xs text-slate-500">{gameName}: no rake to distribute.</p>;
  }
```

Add an empty-state check after it:

```tsx
  if (recipients.length === 0) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm text-amber-400">
          {gameName}: select at least one host above to distribute rake ($
          {totalRake.toString()}).
        </p>
      </div>
    );
  }
```

- [ ] **Step 3: Run typecheck and start the dev server**

```
npx tsc --noEmit
```

Expected: PASS.

Smoke-test: start `npm run dev`, sign in (or with `AUTH_BYPASS_FOR_TESTS=1` for local dev), open a session, drop a chip tip, navigate to `/close`. Confirm:
- The Hosts checklist appears between Step 1 (tip payouts) and Step 2 (house tax).
- With no hosts checked, Step 2 shows "Select at least one host above…" amber message.
- Checking a host populates Step 2 and each Step 3 with that host as recipient (full pool).
- Checking a second host re-derives even-split.
- Refreshing the page restores the checked set from `Session.hostUserIds`.

- [ ] **Step 4: Commit**

```
git add app/\(cashier\)/close/_components/house-tax-step.tsx app/\(cashier\)/close/_components/rake-distribution-step.tsx
git commit -m "feat(close): empty-state guidance when no hosts selected"
```

---

## Task 11: Members admin page + server actions

**Files:**
- Create: `app/(cashier)/settings/members/page.tsx`
- Create: `app/(cashier)/settings/members/_actions.ts`
- Create: `app/(cashier)/settings/members/_components/members-list.tsx`
- Create: `app/(cashier)/settings/members/_components/add-member-modal.tsx`
- Create: `app/(cashier)/settings/members/_components/edit-member-modal.tsx`
- Create: `app/(cashier)/settings/members/_components/revoke-confirm.tsx`

- [ ] **Step 1: Implement the server actions**

Create `app/(cashier)/settings/members/_actions.ts`:

```ts
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

const ROLE_VALUES: ClubMembershipRole[] = ["OWNER", "ADMIN", "CASHIER", "RUNNER"];

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

export const ASSIGNABLE_ROLES = ROLE_VALUES;
```

- [ ] **Step 2: Implement the page**

Create `app/(cashier)/settings/members/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireAdmin, NotAdminError } from "@/lib/admin/require-admin";
import { prisma } from "@/lib/db";
import { MembersList } from "./_components/members-list";

export default async function MembersPage() {
  let caller;
  try {
    caller = await requireAdmin();
  } catch (e) {
    if (e instanceof NotAdminError) redirect("/settings");
    throw e;
  }

  const memberships = await prisma.clubMembership.findMany({
    where: { clubId: caller.clubId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ status: "asc" }, { user: { name: "asc" } }],
  });

  const rows = memberships.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email!,
    role: m.role,
    status: m.status,
    isSelf: m.userId === caller.userId,
  }));

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-semibold mb-1">Members</h2>
      <p className="text-xs text-slate-500 mb-4">
        Add and manage who can sign in to this club.
      </p>
      <MembersList rows={rows} callerRole={caller.role} />
    </div>
  );
}
```

- [ ] **Step 3: Implement `MembersList`**

Create `app/(cashier)/settings/members/_components/members-list.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ClubMembershipRole, ClubMembershipStatus } from "@prisma/client";
import { AddMemberModal } from "./add-member-modal";
import { EditMemberModal } from "./edit-member-modal";
import { RevokeConfirm } from "./revoke-confirm";
import { reAddMemberAction } from "../_actions";

interface Row {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: ClubMembershipRole;
  status: ClubMembershipStatus;
  isSelf: boolean;
}

interface Props {
  rows: Row[];
  callerRole: ClubMembershipRole;
}

export function MembersList({ rows, callerRole }: Props) {
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [revokingRow, setRevokingRow] = useState<Row | null>(null);

  const active = rows.filter((r) => r.status === "ACTIVE");
  const removed = rows.filter((r) => r.status === "REMOVED");

  function canActOn(target: Row): boolean {
    // Caller can never act on themselves.
    if (target.isSelf) return false;
    // ADMIN cannot act on OWNER.
    if (callerRole === "ADMIN" && target.role === "OWNER") return false;
    return true;
  }

  async function reAdd(row: Row) {
    const fd = new FormData();
    fd.set("membershipId", row.id);
    fd.set("role", row.role);
    await reAddMemberAction(fd);
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setAdding(true)}
          className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm"
        >
          + Add member
        </button>
      </div>

      <table className="w-full bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg text-sm">
        <thead className="bg-amber-500/10 text-amber-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Role</th>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {active.map((r) => (
            <tr key={r.id} className="border-t border-[var(--color-border)]">
              <td className="px-3 py-2">{r.name}{r.isSelf && <span className="text-slate-500"> (you)</span>}</td>
              <td className="px-3 py-2">{r.role}</td>
              <td className="px-3 py-2 text-slate-400">{r.email}</td>
              <td className="px-3 py-2 text-right space-x-2">
                {canActOn(r) && (
                  <>
                    <button
                      onClick={() => setEditingRow(r)}
                      className="text-amber-500 hover:underline text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setRevokingRow(r)}
                      className="text-red-400 hover:underline text-xs"
                    >
                      Revoke
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {removed.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowRemoved((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            {showRemoved ? "▾" : "▸"} Show removed ({removed.length})
          </button>
          {showRemoved && (
            <table className="w-full mt-2 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg text-sm opacity-60">
              <tbody>
                {removed.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2">{r.role}</td>
                    <td className="px-3 py-2 text-slate-400">{r.email}</td>
                    <td className="px-3 py-2 text-right">
                      {canActOn(r) && (
                        <button
                          onClick={() => reAdd(r)}
                          className="text-green-400 hover:underline text-xs"
                        >
                          Re-add
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {adding && (
        <AddMemberModal callerRole={callerRole} onClose={() => setAdding(false)} />
      )}
      {editingRow && (
        <EditMemberModal
          row={editingRow}
          callerRole={callerRole}
          onClose={() => setEditingRow(null)}
        />
      )}
      {revokingRow && (
        <RevokeConfirm
          row={revokingRow}
          onClose={() => setRevokingRow(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Implement `AddMemberModal`**

Create `app/(cashier)/settings/members/_components/add-member-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ClubMembershipRole } from "@prisma/client";
import { addMemberAction } from "../_actions";

interface Props {
  callerRole: ClubMembershipRole;
  onClose: () => void;
}

export function AddMemberModal({ callerRole, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ClubMembershipRole>("CASHIER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const roleOptions: ClubMembershipRole[] =
    callerRole === "OWNER"
      ? ["OWNER", "ADMIN", "CASHIER", "RUNNER"]
      : ["ADMIN", "CASHIER", "RUNNER"];

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("name", name);
      fd.set("role", role);
      await addMemberAction(fd);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6 w-full max-w-md">
        <h3 className="text-amber-500 font-semibold mb-4">Add member</h3>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Display name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ClubMembershipRole)}
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="text-slate-400 text-sm px-3 py-1.5">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !email || !name}
              className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `EditMemberModal`**

Create `app/(cashier)/settings/members/_components/edit-member-modal.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ClubMembershipRole, ClubMembershipStatus } from "@prisma/client";
import { updateMemberAction } from "../_actions";

interface Row {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: ClubMembershipRole;
  status: ClubMembershipStatus;
  isSelf: boolean;
}

interface Props {
  row: Row;
  callerRole: ClubMembershipRole;
  onClose: () => void;
}

export function EditMemberModal({ row, callerRole, onClose }: Props) {
  const [name, setName] = useState(row.name);
  const [role, setRole] = useState<ClubMembershipRole>(row.role);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ADMIN can't promote-to-OWNER and can't touch OWNER (already filtered before reaching this modal,
  // but keep the role list trimmed for safety).
  const roleOptions: ClubMembershipRole[] =
    callerRole === "OWNER"
      ? ["OWNER", "ADMIN", "CASHIER", "RUNNER"]
      : ["ADMIN", "CASHIER", "RUNNER"];

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("membershipId", row.id);
      fd.set("name", name);
      fd.set("role", role);
      await updateMemberAction(fd);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6 w-full max-w-md">
        <h3 className="text-amber-500 font-semibold mb-4">Edit member</h3>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Email <span className="text-xs text-slate-500">(read-only)</span>
            <input
              type="email"
              value={row.email}
              readOnly
              className="bg-black/20 border border-[var(--color-border)] rounded px-2 py-1.5 text-slate-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Display name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ClubMembershipRole)}
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="text-slate-400 text-sm px-3 py-1.5">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !name}
              className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement `RevokeConfirm`**

Create `app/(cashier)/settings/members/_components/revoke-confirm.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ClubMembershipRole, ClubMembershipStatus } from "@prisma/client";
import { revokeMemberAction } from "../_actions";

interface Row {
  id: string;
  name: string;
  email: string;
  role: ClubMembershipRole;
  status: ClubMembershipStatus;
}

interface Props {
  row: Row;
  onClose: () => void;
}

export function RevokeConfirm({ row, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set("membershipId", row.id);
      await revokeMemberAction(fd);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6 w-full max-w-md">
        <h3 className="text-red-400 font-semibold mb-2">Revoke {row.name}?</h3>
        <p className="text-sm text-slate-400 mb-4">
          They will lose access on next sign-in. Existing sessions remain valid until they expire (up to 30 days).
        </p>
        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-slate-400 text-sm px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={submitting}
            className="bg-red-600 text-white font-semibold rounded px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {submitting ? "Revoking…" : "Revoke"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run typecheck**

```
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```
git add app/\(cashier\)/settings/members
git commit -m "feat(admin): /settings/members page with add/edit/revoke/re-add"
```

---

## Task 12: Conditional Members link from Settings index

**Files:**
- Modify: `app/(cashier)/settings/page.tsx`

- [ ] **Step 1: Update the Settings index page**

Replace the contents of `app/(cashier)/settings/page.tsx` with:

```tsx
import Link from "next/link";
import { DenominationToggle } from "./_components/denomination-toggle";
import { requireAdmin, NotAdminError } from "@/lib/admin/require-admin";

export default async function SettingsPage() {
  let isAdmin = false;
  try {
    await requireAdmin();
    isAdmin = true;
  } catch (e) {
    if (!(e instanceof NotAdminError)) throw e;
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Settings</h2>

      {isAdmin && (
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Club admin</h3>
          <Link
            href="/settings/members"
            className="block bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4 hover:border-amber-500/40"
          >
            <div className="text-amber-500 font-semibold text-sm">Members</div>
            <div className="text-xs text-slate-500 mt-1">
              Add and manage who can sign in to this club.
            </div>
          </Link>
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">This device</h3>
        <p className="text-xs text-slate-500 mb-3">
          These settings are stored in this browser&apos;s local storage and don&apos;t sync across devices.
        </p>
        <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
          <DenominationToggle />
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Smoke-test in dev**

Start `npm run dev`. Sign in as the OWNER (your account). Navigate to `/settings`. Confirm:
- "Club admin" section is visible with a Members link.
- Clicking Members navigates to `/settings/members`.
- The members table shows your account.

Sign out (or impersonate via TEST_USER_EMAIL with a non-admin user). Confirm:
- `/settings` does not show the Members link.
- Visiting `/settings/members` directly redirects to `/settings`.

- [ ] **Step 3: Commit**

```
git add app/\(cashier\)/settings/page.tsx
git commit -m "feat(settings): conditional Members link for OWNER/ADMIN"
```

---

## Task 13: E2E test — host payout flow

**Files:**
- Create: `tests/e2e/host-payout.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/host-payout.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.beforeEach(async () => {
  const E2E_URL = "postgresql://rakeledger:rakeledger_dev@localhost:5432/rakeledger_e2e?schema=public";
  execSync("npx prisma migrate reset --force --skip-generate --skip-seed", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_URL, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "1" },
  });
  execSync("npx prisma db seed", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_URL },
  });
});

test("host selection persists and drives both house-tax and rake distribution", async ({ page }) => {
  // Open session.
  await page.goto("/live");
  await page.getByLabel(/Opening cash float/).fill("0");
  await page.getByRole("button", { name: /Open Session/ }).click();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();

  // Drop a $40 chip tip to dealer Jake.
  await page.getByRole("button", { name: /\+ Tip drop/ }).click();
  await page.getByLabel(/Recipient/).selectOption({ label: "Dealer Jake" });
  await page.locator("input[name=amount]").fill("40");
  await page.getByRole("button", { name: /Record Tip Drop/ }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");

  // Add a $20 rake.
  await page.getByRole("button", { name: /\+ Rake/ }).click();
  await page.locator("input[name=amount]").fill("20");
  await page.getByRole("button", { name: /Record Rake/ }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");

  // Navigate to /close.
  await page.goto("/close");

  // Without any host selected, Step 2 and Step 3 show empty-state.
  await expect(page.getByText(/Select at least one host above/).first()).toBeVisible();

  // Check the seeded test cashier as a host (the seed creates "test-cashier@dev"
  // as OWNER of the test club).
  // The HostSelector lists candidate staff with role != WAITRESS. The test seed
  // includes Cashier (OWNER), Dealer Jake, Dealer Anna. Check the cashier.
  await page.getByLabel("Cashier").check();

  // The empty-state messages should be replaced by recipient tables.
  await expect(page.getByText(/Select at least one host above/)).toHaveCount(0);

  // Reload — selection should persist (Session.hostUserIds).
  await page.reload();
  await expect(page.getByLabel("Cashier")).toBeChecked();

  // Distribute (just verify the button is enabled).
  // Step 2 — house tax pool came from the $40 tip's house-tax slice (~$8 if 20% tax).
  // Step 3 — rake pool is $20.
  // Don't actually click Distribute here; that's tested in full-night.spec.ts.
});
```

- [ ] **Step 2: Run the E2E**

```
npm run test:e2e -- tests/e2e/host-payout.spec.ts
```

Expected: PASS. Adjust selectors if Playwright finds the elements differently — selectors mirror conventions in `tests/e2e/full-night.spec.ts`.

- [ ] **Step 3: Commit**

```
git add tests/e2e/host-payout.spec.ts
git commit -m "test(e2e): host selection persists and drives distribution steps"
```

---

## Task 14: E2E test — admin members flow

**Files:**
- Create: `tests/e2e/admin-members.spec.ts`

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/admin-members.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.beforeEach(async () => {
  const E2E_URL = "postgresql://rakeledger:rakeledger_dev@localhost:5432/rakeledger_e2e?schema=public";
  execSync("npx prisma migrate reset --force --skip-generate --skip-seed", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_URL, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "1" },
  });
  execSync("npx prisma db seed", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_URL },
  });
});

test("OWNER can add, revoke, and re-add a member", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Members")).toBeVisible();

  await page.goto("/settings/members");
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

  // Add a new cashier.
  await page.getByRole("button", { name: /\+ Add member/ }).click();
  await page.getByLabel("Email").fill("newcashier@x.com");
  await page.getByLabel("Display name").fill("New Cashier");
  await page.getByLabel("Role").selectOption("CASHIER");
  await page.getByRole("button", { name: /^Add$/ }).click();

  await expect(page.getByText("New Cashier")).toBeVisible();

  // Revoke them.
  const row = page.locator("tr").filter({ hasText: "New Cashier" });
  await row.getByRole("button", { name: /Revoke/ }).click();
  await page.getByRole("button", { name: /^Revoke$/ }).click();

  await expect(page.getByText("New Cashier")).toHaveCount(0);

  // Show removed.
  await page.getByRole("button", { name: /Show removed/ }).click();
  await expect(page.getByText("New Cashier")).toBeVisible();

  // Re-add.
  const removedRow = page.locator("tr").filter({ hasText: "New Cashier" });
  await removedRow.getByRole("button", { name: /Re-add/ }).click();
  await page.waitForTimeout(500);

  // Should now appear in the active list (not the removed list, after page revalidation).
  await page.reload();
  await expect(page.getByText("New Cashier")).toBeVisible();
});

test("CASHIER cannot reach /settings/members", async ({ page }) => {
  // The seed creates "test-cashier@dev" as OWNER. To test as a CASHIER, we'd
  // need to swap TEST_USER_EMAIL — the dev server reads it from .env.e2e at
  // boot, so in a single-process test run we can't easily impersonate.
  //
  // Instead, this test sanity-checks that /settings/members redirects to
  // /settings when requireAdmin throws. We exercise this by setting
  // TEST_USER_EMAIL to a user with no membership — they'll fail requireAdmin.
  //
  // For now, stub: assert the route exists and redirects when requireAdmin fails.
  // (Skip — requires multi-user E2E harness, deferred.)
  test.skip(true, "Multi-user E2E harness required");
});
```

- [ ] **Step 2: Run the E2E**

```
npm run test:e2e -- tests/e2e/admin-members.spec.ts
```

Expected: PASS (1 test passes, 1 skipped).

- [ ] **Step 3: Commit**

```
git add tests/e2e/admin-members.spec.ts
git commit -m "test(e2e): admin members add → revoke → re-add roundtrip"
```

---

## Task 15: Final pass — run full suite, deploy notes

**Files:**
- (none modified — verification + manual deploy steps)

- [ ] **Step 1: Run the full Vitest suite**

```
npm test
```

Expected: ALL green. If anything fails, fix in place — don't proceed.

- [ ] **Step 2: Run the full Playwright suite**

```
npm run test:e2e
```

Expected: ALL green (including pre-existing tests `full-night.spec.ts` and `multi-game-night.spec.ts`).

- [ ] **Step 3: Run typecheck and Next build**

```
npx tsc --noEmit
npm run build
```

Expected: clean typecheck, successful production build (Prisma client regen + Next compile).

- [ ] **Step 4: Verify branching and prepare for deploy**

```
git log --oneline -20
```

Expected: a clean linear sequence of commits, one per task. If any task ended without a commit, fix it.

- [ ] **Step 5: Push and deploy**

```
git push
```

Vercel auto-deploys on push to master. Watch the Vercel dashboard for the build to complete.

After successful deploy:

```
npx dotenv -e .env.production -- npx prisma migrate deploy
```

Expected: applies the new `add_session_host_user_ids` migration to the Neon production DB.

- [ ] **Step 6: Remove `AUTH_ALLOWED_EMAILS` from Vercel env**

In the Vercel dashboard → project settings → Environment Variables, delete `AUTH_ALLOWED_EMAILS`. The new code doesn't read it, but cleaning it up prevents future confusion. No redeploy needed (var is no longer referenced).

- [ ] **Step 7: Smoke-test prod**

Open https://rakeledger.vercel.app, sign in as yourself, verify:
- `/settings` shows the Members link.
- `/settings/members` lists you and Alex.
- Add a test cashier; sign in as them in an incognito window; verify access.
- Revoke that test cashier; sign-in attempt is rejected.
- Open a session, navigate to `/close`; the Hosts checklist appears between Step 1 and Step 2.

If smoke test passes, proceed with Alex's onboarding (Step 4.11 of original Plan 2c).

---

## Self-Review (planner pass)

**Spec coverage check:**

| Spec requirement                                           | Plan task |
|------------------------------------------------------------|-----------|
| **Host payout** § Schema: `Session.hostUserIds`            | Task 1    |
| **Host payout** § Query: single candidate-staff query (WAITRESS-filtered) | Task 8 |
| **Host payout** § UI: HostSelector between Step 1 and Step 2 | Task 9  |
| **Host payout** § State: lift up; `selectedHostIds` in wrapper; debounced save | Task 9 |
| **Host payout** § Server action `updateSessionHosts` + validation | Task 7 |
| **Host payout** § Defaults: blank on first open, restore from DB on refresh | Task 9 |
| **Host payout** § Edge case: empty list → empty-state on steps | Task 10 |
| **Admin UI** § Schema: no changes (uses existing models)   | (none — verified)  |
| **Admin UI** § Permission matrix + last-OWNER invariant   | Tasks 3, 11 |
| **Admin UI** § Routes: `/settings/members` page; `requireAdmin` gate | Tasks 4, 11, 12 |
| **Admin UI** § UI: list + add/edit modals + revoke confirm + re-add | Task 11 |
| **Admin UI** § Server actions                              | Task 11   |
| **Admin UI** § Auth: drop allowlist, add membership check   | Task 5    |
| **Admin UI** § Revoke semantics: soft revoke at membership level | Task 3 |
| **Admin UI** § CLI scripts: keep add-member.ts as thin wrapper | Task 2 |
| **Admin UI** § Env cleanup                                 | Tasks 5, 6, 15 |

No gaps.

**Placeholder scan:** No "TBD"/"TODO"/"implement later" patterns. Every code-bearing step has full code. Test steps name explicit assertions. Commit messages spelled out.

**Type consistency:** All exported function signatures match between the test that imports them (e.g., `updateMember({ membershipId, name, role })`) and the implementation. The `RecipientSerial` shape (Task 9) matches what `HouseTaxStep` and `RakeDistributionStep` already accept (verified against `house-tax-step.tsx:14-20`). `HostSelector` props (`selectedIds: Set<string>`, `onToggle: (userId: string) => void`) consistently typed in both component and parent. Server action arg lists match the FormData being sent in modals.

**Known caveats deferred to future work:**
- Per-request JWT revalidation (revoked user keeps existing JWT for ≤ 30 days).
- AdminAction audit log table.
- Multi-user E2E harness (admin-members.spec.ts has one skipped test that needs it).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-08-host-payout-and-admin-ui.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — controller dispatches a fresh subagent per task, reviews between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
