# Plan 2c — Auth + Production Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get RakeLedger ready for first real production use by the user's friend at "The Office" cardroom. Add Google OAuth via NextAuth (Auth.js v5) with an email allowlist, replace the hardcoded cashier user with auth-derived identity, and add the schema-level multi-tenant foundation (`Club` + `ClubMembership` + nullable `clubId` columns) that Phase A of the multi-tenant roadmap will refactor queries against later.

**Architecture:** Single-tenant deploy, but **schema is multi-tenant ready**. One `Club` row ("The Office") seeded; one `User` (Alex Chavez); one `ClubMembership` linking them. Every model that will eventually be tenant-scoped already has a nullable `clubId` column populated for the seeded data. Queries do NOT yet filter by `clubId` — that's Phase A. NextAuth uses Google OAuth and the `signIn` callback rejects emails not in the `AUTH_ALLOWED_EMAILS` env var. After successful sign-in, the User row is looked up by email and the active club is resolved from `ClubMembership`.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript 5, Prisma 6.19.3, Postgres 16, Auth.js v5 (`next-auth@^5.0.0`) + `@auth/prisma-adapter`, Vitest 4.1.5, Tailwind v4, decimal.js, Zod.

**Out of scope (Phase A — separate future plan):**
- Refactoring 30-40 queries to filter by `clubId`
- Adding a club-switcher UI
- Public sign-up flow
- Invite UI for adding members (we use CLI scripts in this plan)

**Worktree note:** This plan continues development in the existing `rakeledger` working directory. The implementer should branch off `master` (`git checkout -b plan-2c-auth-and-production`) before starting Task 1.

**Production deploy is part of this plan.** Tasks 1-3 are pure code work. Task 4 is a **destructive cutover** — wipes the prod Neon DB, reseeds with The Office's real data, and verifies the live site. The user will be in the loop for any prod-touching commands (which require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` consent or are direct user actions).

---

## File structure

**New files**

| Path | Responsibility |
|---|---|
| `lib/auth.ts` | Auth.js v5 root config: providers, callbacks (signIn allowlist, session enrichment), exports `auth`, `handlers`, `signIn`, `signOut` |
| `app/api/auth/[...nextauth]/route.ts` | Re-exports the GET/POST handlers from `lib/auth.ts` |
| `app/auth/signin/page.tsx` | Sign-in page with "Sign in with Google" button |
| `app/auth/error/page.tsx` | Sign-in error page (handles `AccessDenied` for non-allowlisted emails) |
| `middleware.ts` | Auth-aware middleware: protects all non-public routes, sets `x-pathname` header for layout |
| `lib/active-user.ts` | `getActiveUser()` and `getActiveClub()` helpers — reads the Auth.js session, looks up the User in DB, returns User + active Club. Replaces `getCashierUserId()`. |
| `scripts/provision-club.ts` | CLI: creates Club + Owner User + ClubMembership + SystemSettings + (optional) default Game/Table |
| `scripts/add-member.ts` | CLI: adds User to existing Club (creates User if missing by email) |
| `tests/unit/auth/allowlist.test.ts` | Allowlist parsing logic |
| `tests/unit/scripts/provision-club.test.ts` | Provisioning logic |
| `tests/unit/scripts/add-member.test.ts` | Member-add logic incl. existing-user-reuse |
| `docs/ALEX_ONBOARDING.md` | Short markdown doc for Alex: URL, sign-in flow, "open a session" / "record a buy-in" / "close the night" |

**Modified files**

| Path | Change |
|---|---|
| `prisma/schema.prisma` | Add `Club`, `ClubMembership` models; add nullable `clubId` FK to `User`, `Session`, `Player`, `Table`, `Game`, `Marker`, `SystemSettings`, `Transaction`; add indexes |
| `prisma/migrations/<new>/migration.sql` | Generated migration |
| `prisma/seed.ts` | Read `SEED_CLUB_NAME`, `SEED_OWNER_EMAIL`, `SEED_OWNER_NAME`, `SEED_DEFAULT_GAME_NAME` env vars; create The Office club + Alex Chavez owner + ClubMembership; seed dev cashier still exists for tests |
| `app/(cashier)/_actions/_cashier.ts` | Replace `getCashierUserId()` with re-export of `getActiveUser()` from `lib/active-user.ts` (keep the old name as a thin alias for now to avoid touching every caller) |
| `app/(cashier)/_actions/session.ts` | `openSession` reads default game name from env var (`SEED_DEFAULT_GAME_NAME`), falling back to "Main Game"; sets `clubId` from active user's club |
| `app/(cashier)/layout.tsx` | Add user identity widget in nav sidebar with sign-out link |
| `package.json` | Add `next-auth@^5.0.0`, `@auth/prisma-adapter@^2.0.0` |
| `.env.example`, `.env.test.example`, `.env.e2e.example` | Add `AUTH_*`, `SEED_*` vars |
| `tests/unit/test-db.ts` | Update `resetDatabase` to seed a default Club + ClubMembership for the test cashier |

---

## Task 1: Schema multi-tenant foundation + env-driven seed

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<auto-named>/migration.sql` (via `prisma migrate dev`)
- Modify: `prisma/seed.ts`
- Modify: `tests/unit/test-db.ts`
- Modify: `.env.example`, `.env.test.example`, `.env.e2e.example`
- Create: `tests/unit/seed.test.ts` (smoke test for the env-driven seed)

The `Club` model is the tenant container. `ClubMembership` is the join table that lets a single User belong to multiple Clubs. Every existing scoped model gets a nullable `clubId` column — Phase A's job is to refactor the queries to filter on it; Plan 2c only needs to add and populate the columns.

- [ ] **Step 1: Add Club and ClubMembership to the schema**

Edit `prisma/schema.prisma`. Add these enums + models after the existing `enum PickupStatus` block (around line 102):

```prisma
enum ClubMembershipRole {
  OWNER
  ADMIN
  CASHIER
  RUNNER
  // DEALER and WAITRESS are User.role only (staff records, no app login)
}

enum ClubMembershipStatus {
  ACTIVE
  REMOVED
}

model Club {
  id          String              @id @default(cuid())
  name        String
  slug        String              @unique
  createdAt   DateTime            @default(now())

  memberships ClubMembership[]
  users       User[]              @relation("UserPrimaryClub")
  sessions    Session[]
  players     Player[]
  tables      Table[]
  games       Game[]
  markers     Marker[]
  settings    SystemSettings?
  transactions Transaction[]

  @@index([slug])
}

model ClubMembership {
  id        String                  @id @default(cuid())
  user      User                    @relation(fields: [userId], references: [id])
  userId    String
  club      Club                    @relation(fields: [clubId], references: [id])
  clubId    String
  role      ClubMembershipRole
  status    ClubMembershipStatus    @default(ACTIVE)
  createdAt DateTime                @default(now())

  @@unique([userId, clubId])
  @@index([clubId, status])
}
```

Then add a nullable `clubId` FK + relation to each of these models (find each one and add the two lines):

- `User` — add `clubId String?`, `club Club? @relation("UserPrimaryClub", fields: [clubId], references: [id])`, and `memberships ClubMembership[]`. Also `@@index([clubId])`.
- `Session` — add `clubId String?`, `club Club? @relation(fields: [clubId], references: [id])`. `@@index([clubId])`.
- `Player` — add `clubId String?`, `club Club? @relation(fields: [clubId], references: [id])`. `@@index([clubId])`.
- `Table` — same shape.
- `Game` — same shape.
- `Marker` — same shape.
- `Transaction` — same shape (denormalized for query perf).
- `SystemSettings` — change from singleton to one-per-club. Replace the existing model entirely:
  ```prisma
  model SystemSettings {
    id                    String  @id @default(cuid())
    clubId                String? @unique
    club                  Club?   @relation(fields: [clubId], references: [id], onDelete: Cascade)
    defaultTipTaxRate     Decimal @default(0.20) @db.Decimal(5, 4)
    pickupTimeoutSeconds  Int     @default(300)
    rakeSplitDefaults     Json    @default("{}")
    houseTaxSplitDefaults Json    @default("{}")
  }
  ```
  The original `id Int @id @default(1)` singleton pattern goes away — `id` becomes a normal cuid PK and uniqueness is now enforced by `clubId @unique`. The seed will create one row per Club, NOT a global row.
  **Migration consideration:** Prisma will see this as a column type change (Int → String). For an empty prod DB this is fine; for the dev DB with a seeded id=1 row, the existing row gets dropped and recreated by the seed in Step 3. Verify the migration drops & recreates the table or uses a manual SQL transform.

For each FK use `onDelete: SetNull` so deleting a Club doesn't cascade-delete tons of data (defense for the future). Example:

```prisma
club Club? @relation(fields: [clubId], references: [id], onDelete: SetNull)
```

- [ ] **Step 2: Generate the migration**

```bash
npx prisma migrate dev --name add_club_and_clubid_columns
```

Expected: a new migration directory under `prisma/migrations/`. The SQL should add the `Club` table, the `ClubMembership` table, and `clubId` columns + indexes on the listed tables. Verify the migration is reversible (drop columns + drop tables) — Prisma generates this automatically.

If the migration fails because a column rename/check conflicts, paste the error and stop — do not force-reset.

- [ ] **Step 3: Update the seed script for env-driven owner + club creation**

Replace the contents of `prisma/seed.ts` with:

```ts
import { PrismaClient, ClubMembershipRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Read seed config from env (with defaults that match dev expectations)
  const clubName = process.env.SEED_CLUB_NAME ?? "Dev Cardroom";
  const clubSlug = (process.env.SEED_CLUB_SLUG ?? clubName.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "");
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "cashier@dev.local";
  const ownerName = process.env.SEED_OWNER_NAME ?? "Cashier";
  // SEED_DEFAULT_GAME_NAME is read by openSession at runtime, not by seed itself

  // 1. Club
  const club = await prisma.club.upsert({
    where: { slug: clubSlug },
    update: { name: clubName },
    create: { name: clubName, slug: clubSlug },
  });

  // 2. Owner user
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: { name: ownerName, status: "ACTIVE", clubId: club.id },
    create: {
      email: ownerEmail,
      name: ownerName,
      role: "CASHIER", // owner role is on ClubMembership; User.role keeps a default for legacy callers
      status: "ACTIVE",
      clubId: club.id,
    },
  });

  // 3. Owner ClubMembership (OWNER role at this club)
  await prisma.clubMembership.upsert({
    where: { userId_clubId: { userId: owner.id, clubId: club.id } },
    update: { role: ClubMembershipRole.OWNER, status: "ACTIVE" },
    create: { userId: owner.id, clubId: club.id, role: ClubMembershipRole.OWNER, status: "ACTIVE" },
  });

  // 4. Sample staff (no logins) — only seeded in dev, skipped if SEED_SKIP_SAMPLE_STAFF=true
  if (process.env.SEED_SKIP_SAMPLE_STAFF !== "true") {
    for (const s of [
      { email: "jake@dev.local", name: "Dealer Jake", role: "DEALER" as const },
      { email: "anna@dev.local", name: "Dealer Anna", role: "DEALER" as const },
      { email: "lila@dev.local", name: "Waitress Lila", role: "WAITRESS" as const },
    ]) {
      await prisma.user.upsert({
        where: { email: s.email },
        update: { clubId: club.id },
        create: { email: s.email, name: s.name, role: s.role, status: "ACTIVE", clubId: club.id },
      });
    }
  }

  // 5. SystemSettings — one-per-club (created/updated by clubId)
  await prisma.systemSettings.upsert({
    where: { clubId: club.id },
    update: {},
    create: { clubId: club.id },
  });

  console.log(`Seed complete. Club: ${club.name} (${club.slug}). Owner: ${owner.email} (${owner.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Update test-db helper**

Edit `tests/unit/test-db.ts`. Update `resetDatabase` to truncate the new tables AND seed a default Club + ClubMembership so existing tests can keep using `createdById: "test-cashier"` without changes:

```ts
export async function resetDatabase() {
  await testPrisma.$executeRawUnsafe(`
    TRUNCATE
      "LedgerEntry",
      "Transaction",
      "Marker",
      "SessionAccountClose",
      "RakeDistribution",
      "CashierHandoff",
      "Game",
      "Session",
      "Table",
      "Player",
      "ClubMembership",
      "Club",
      "UserCapabilityGrant",
      "User",
      "SystemSettings"
    RESTART IDENTITY CASCADE
  `);

  // Seed a deterministic test club + cashier user + membership so tests can write
  // transactions with createdById: "test-cashier" and clubId: "test-club".
  const club = await testPrisma.club.create({
    data: { id: "test-club", name: "Test Club", slug: "test-club" },
  });
  await testPrisma.user.create({
    data: {
      id: "test-cashier",
      name: "Test Cashier",
      email: "test-cashier@dev",
      role: "CASHIER",
      clubId: club.id,
    },
  });
  await testPrisma.clubMembership.create({
    data: { userId: "test-cashier", clubId: club.id, role: "OWNER", status: "ACTIVE" },
  });
  await testPrisma.systemSettings.create({ data: { clubId: club.id } });
}
```

- [ ] **Step 5: Update env example files**

Add to `.env.example`, `.env.test.example`, `.env.e2e.example`:

```
# Plan 2c — seed configuration
SEED_CLUB_NAME="Dev Cardroom"
SEED_CLUB_SLUG="dev-cardroom"
SEED_OWNER_EMAIL="cashier@dev.local"
SEED_OWNER_NAME="Cashier"
SEED_DEFAULT_GAME_NAME="Main Game"

# Auth.js v5 (created in Phase 2)
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""
AUTH_SECRET=""
AUTH_ALLOWED_EMAILS="cashier@dev.local"
# Production-only: enable Auth.js's host trust for serverless platforms
# AUTH_TRUST_HOST="true"
```

The existing `.env`, `.env.test`, `.env.e2e` files (gitignored) need the matching values too — but since the seed has fallbacks for SEED_*, they'll work without explicit values. AUTH_* on the other hand are mandatory once Task 2 ships.

- [ ] **Step 6: Smoke test the seed**

Create `tests/unit/seed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "./test-db";

describe("seed (test fixture)", () => {
  beforeEach(resetDatabase);

  it("seeds a default Club, test cashier User, and ClubMembership", async () => {
    const club = await testPrisma.club.findUnique({ where: { id: "test-club" } });
    expect(club).not.toBeNull();
    expect(club?.slug).toBe("test-club");

    const cashier = await testPrisma.user.findUnique({ where: { id: "test-cashier" } });
    expect(cashier).not.toBeNull();
    expect(cashier?.clubId).toBe("test-club");

    const membership = await testPrisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: "test-cashier", clubId: "test-club" } },
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("OWNER");

    const settings = await testPrisma.systemSettings.findUnique({ where: { clubId: "test-club" } });
    expect(settings).not.toBeNull();
  });
});
```

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: all 68 existing tests + the new seed test pass. If any test breaks because of the schema change (e.g., a model field is required where it used to be optional), fix the test by passing `clubId: "test-club"` to the relevant `create` call.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ prisma/seed.ts tests/unit/test-db.ts tests/unit/seed.test.ts .env.example .env.test.example .env.e2e.example
git commit -m "feat(schema): add Club, ClubMembership, and clubId columns; env-driven seed"
```

---

## Task 2: NextAuth + email allowlist + auth-derived active user

**Files:**
- Create: `lib/auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `app/auth/signin/page.tsx`
- Create: `app/auth/error/page.tsx`
- Create: `middleware.ts`
- Create: `lib/active-user.ts`
- Modify: `app/(cashier)/_actions/_cashier.ts`
- Modify: `app/(cashier)/_actions/session.ts`
- Modify: `app/(cashier)/layout.tsx`
- Modify: `package.json` (adds `next-auth@^5.0.0`)
- Create: `tests/unit/auth/allowlist.test.ts`

Auth.js v5 (the modern next-auth) is the foundation. The flow:

1. Unauthenticated request → middleware redirects to `/auth/signin`
2. User clicks "Sign in with Google" → Google OAuth → callback URL hits `/api/auth/callback/google`
3. Auth.js's `signIn` callback runs: rejects if email not in `AUTH_ALLOWED_EMAILS`, otherwise allows
4. Auth.js's `session` callback enriches the session with `userId` (looked up by email in our `User` table) and `activeClubId` (from `ClubMembership`)
5. User lands on `/live`. Server Components and Server Actions call `getActiveUser()` which reads the session + returns the User row.

If a sign-in is rejected (email not in allowlist), Auth.js redirects to `/auth/error?error=AccessDenied`.

If a user signs in successfully but no `User` row exists in our DB for their email (i.e., they were never provisioned via the seed or the provisioning script), the `signIn` callback also rejects — this is the "User not provisioned" guard the roadmap acceptance criteria calls out.

- [ ] **Step 1: Install Auth.js**

```bash
npm install next-auth@^5.0.0 @auth/prisma-adapter@^2.0.0
```

- [ ] **Step 2: Write the allowlist unit test**

Create `tests/unit/auth/allowlist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isEmailAllowed } from "@/lib/auth";

describe("isEmailAllowed", () => {
  it("returns true for an exact match in a single-entry allowlist", () => {
    expect(isEmailAllowed("alice@example.com", "alice@example.com")).toBe(true);
  });

  it("returns true for any of multiple comma-separated entries", () => {
    const list = "alice@example.com, bob@example.com,carol@example.com";
    expect(isEmailAllowed("bob@example.com", list)).toBe(true);
    expect(isEmailAllowed("carol@example.com", list)).toBe(true);
  });

  it("trims whitespace around entries", () => {
    expect(isEmailAllowed("alice@example.com", "  alice@example.com  ,bob@example.com")).toBe(true);
  });

  it("is case-insensitive on the email", () => {
    expect(isEmailAllowed("ALICE@example.com", "alice@example.com")).toBe(true);
    expect(isEmailAllowed("alice@example.com", "ALICE@EXAMPLE.COM")).toBe(true);
  });

  it("returns false for an email not on the list", () => {
    expect(isEmailAllowed("eve@example.com", "alice@example.com,bob@example.com")).toBe(false);
  });

  it("returns false for null/empty inputs", () => {
    expect(isEmailAllowed(null, "alice@example.com")).toBe(false);
    expect(isEmailAllowed("", "alice@example.com")).toBe(false);
    expect(isEmailAllowed("alice@example.com", "")).toBe(false);
    expect(isEmailAllowed("alice@example.com", undefined)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test, see it fail**

```bash
npm test -- tests/unit/auth/allowlist.test.ts
```

Expected: FAIL — module `@/lib/auth` doesn't exist yet.

- [ ] **Step 4: Implement Auth.js v5 config**

Create `lib/auth.ts`:

```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/db";

export function isEmailAllowed(email: string | null | undefined, allowList: string | undefined | null): boolean {
  if (!email || !allowList) return false;
  const allowed = allowList.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.toLowerCase());
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
  trustHost: true, // required on Vercel & similar platforms
  callbacks: {
    async signIn({ user }) {
      // Allowlist gate — even if Google OAuth succeeds, we reject any email
      // not on AUTH_ALLOWED_EMAILS.
      if (!isEmailAllowed(user.email, process.env.AUTH_ALLOWED_EMAILS)) {
        return false;
      }
      // Provisioning gate — must have a User row in our DB.
      // Plan 2c relies on seeding (Task 1) to create at least one User per allowed email;
      // future Phase A adds provision-club.ts/add-member.ts for new ones.
      const dbUser = await prisma.user.findUnique({ where: { email: user.email! } });
      if (!dbUser || dbUser.status !== "ACTIVE") return false;
      return true;
    },
    async jwt({ token, user }) {
      // First sign-in: load DB user + active club into the token
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          include: {
            memberships: {
              where: { status: "ACTIVE" },
              include: { club: true },
              take: 1, // Plan 2c: each user has exactly one active membership
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
      session.user.id = token.dbUserId as string;
      session.user.clubId = (token.activeClubId as string | null) ?? null;
      session.user.clubName = (token.activeClubName as string | null) ?? null;
      return session;
    },
  },
});
```

- [ ] **Step 5: Run the test, see it pass**

```bash
npm test -- tests/unit/auth/allowlist.test.ts
```

Expected: PASS (6/6).

- [ ] **Step 6: Wire the route handlers**

Create `app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 7: Build the sign-in page**

Create `app/auth/signin/page.tsx`:

```tsx
import { signIn } from "@/lib/auth";

export default function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-white flex items-center justify-center p-4">
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-8 w-full max-w-sm">
        <div className="text-amber-500 font-bold text-2xl mb-2 text-center">♠ RakeLedger</div>
        <p className="text-sm text-slate-400 text-center mb-6">
          Sign in with the Google account associated with your cardroom.
        </p>
        <form
          action={async () => {
            "use server";
            const sp = await searchParams;
            await signIn("google", { redirectTo: sp.callbackUrl ?? "/live" });
          }}
        >
          <button
            type="submit"
            className="w-full bg-amber-500 text-black font-semibold rounded px-4 py-3 hover:bg-amber-400"
          >
            Sign in with Google
          </button>
        </form>
        <p className="text-xs text-slate-500 mt-4 text-center">
          Only authorized accounts can sign in. If you can&apos;t access the app, contact your cardroom owner.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Build the error page**

Create `app/auth/error/page.tsx`:

```tsx
export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const error = sp.error ?? "Unknown";
  const message =
    error === "AccessDenied"
      ? "Your Google account isn't authorized to access this RakeLedger deployment. Contact the cardroom owner to be added."
      : `Sign-in failed: ${error}.`;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-white flex items-center justify-center p-4">
      <div className="bg-[var(--color-panel)] border border-red-900 rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-red-400 font-semibold text-lg mb-2">Sign-in problem</h1>
        <p className="text-sm text-slate-300 mb-4">{message}</p>
        <a href="/auth/signin" className="text-amber-500 hover:underline text-sm">
          Try again
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Add middleware**

Create `middleware.ts` (at the project root, NOT inside `app/`):

```ts
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/auth/signin", "/auth/error", "/api/auth"];

export default auth((req) => {
  const { nextUrl } = req;
  const isPublic = PUBLIC_PATHS.some((p) => nextUrl.pathname.startsWith(p));
  const isAuthenticated = !!req.auth;

  // Always set x-pathname so the cashier layout can highlight the active nav item.
  const headers = new Headers(req.headers);
  headers.set("x-pathname", nextUrl.pathname);

  if (isPublic) {
    return NextResponse.next({ request: { headers } });
  }

  if (!isAuthenticated) {
    const signInUrl = new URL("/auth/signin", nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next({ request: { headers } });
});

export const config = {
  // Match all paths except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
```

- [ ] **Step 10: Build the active-user helper**

Create `lib/active-user.ts`:

```ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * Returns the currently signed-in User row from the DB, plus their active Club.
 * Throws NotAuthenticatedError if no session.
 *
 * In tests (process.env.NODE_ENV === "test"), falls back to looking up `process.env.TEST_USER_EMAIL`
 * (default "test-cashier@dev") so test code that imports this helper doesn't need to mock auth.
 * Most tests use `createTransaction` directly with `createdById: "test-cashier"` and don't hit this path.
 */
export async function getActiveUser() {
  if (process.env.NODE_ENV === "test") {
    const email = process.env.TEST_USER_EMAIL ?? "test-cashier@dev";
    const user = await prisma.user.findUnique({
      where: { email },
      include: { club: true },
    });
    if (!user) throw new NotAuthenticatedError();
    return user;
  }

  const session = await auth();
  if (!session?.user?.email) throw new NotAuthenticatedError();
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { club: true },
  });
  if (!user) throw new NotAuthenticatedError();
  return user;
}

/** Convenience: just the user id. Drop-in replacement for getCashierUserId(). */
export async function getActiveUserId(): Promise<string> {
  const user = await getActiveUser();
  return user.id;
}

/** Convenience: just the active club id. Returns null if user has no membership yet. */
export async function getActiveClubId(): Promise<string | null> {
  const user = await getActiveUser();
  return user.clubId;
}
```

- [ ] **Step 11: Replace getCashierUserId**

Edit `app/(cashier)/_actions/_cashier.ts`. Replace the entire file:

```ts
"use server";

import { getActiveUserId } from "@/lib/active-user";

/**
 * Returns the active user's ID. Backward-compatible name retained from Plan 1
 * to avoid touching every Server Action; the underlying lookup now uses the
 * Auth.js session instead of a hardcoded email.
 */
export async function getCashierUserId(): Promise<string> {
  return getActiveUserId();
}
```

- [ ] **Step 12: Wire openSession to use SEED_DEFAULT_GAME_NAME and active club**

Edit `app/(cashier)/_actions/session.ts`. The current `openSession` hardcodes `name: "Main Game"`. Update:

```ts
import { getActiveClubId } from "@/lib/active-user";
// ... existing imports
```

In `openSession`, replace:

```ts
const game = await prisma.game.create({
  data: {
    sessionId: session.id,
    name: "Main Game",
    rakeSplitConfig: { type: "even" },
  },
});
```

with:

```ts
const clubId = await getActiveClubId();
const game = await prisma.game.create({
  data: {
    sessionId: session.id,
    clubId,
    name: process.env.SEED_DEFAULT_GAME_NAME ?? "Main Game",
    rakeSplitConfig: { type: "even" },
  },
});
```

Also update the `prisma.session.create` call to include `clubId` (next to `openedById`):

```ts
const session = await prisma.session.create({
  data: {
    openedById: cashierId,
    clubId,
    openingCash: openingCash.toString(),
  },
});
```

- [ ] **Step 13: Add user identity widget to the cashier nav**

Edit `app/(cashier)/layout.tsx`. Currently it just renders `<NavSidebar>` and `<main>`. Add an identity widget at the bottom of the nav showing the user's name + a sign-out form, AND show the current club name in the header.

Edit `components/nav-sidebar.tsx` to accept new props `userName: string | null`, `clubName: string | null` and render them at the bottom (above the existing Settings link), plus a sign-out form. Then update `layout.tsx` to fetch and pass these:

```tsx
import { headers } from "next/headers";
import { NavSidebar } from "@/components/nav-sidebar";
import { ToastProvider } from "@/components/toast/toast-provider";
import { auth, signOut } from "@/lib/auth";

export default async function CashierLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const activePath = h.get("x-pathname") ?? "/live";
  const session = await auth();
  return (
    <ToastProvider>
      <div className="grid grid-cols-[220px_1fr] min-h-screen">
        <NavSidebar
          activePath={activePath}
          userName={session?.user?.name ?? null}
          userEmail={session?.user?.email ?? null}
          clubName={session?.user?.clubName ?? null}
          signOutAction={async () => { "use server"; await signOut({ redirectTo: "/auth/signin" }); }}
        />
        <main className="p-4">{children}</main>
      </div>
    </ToastProvider>
  );
}
```

In `nav-sidebar.tsx`, add right above the `bottomItems` nav block:

```tsx
{userName && (
  <div className="mb-3 px-2 py-2 border-t border-[var(--color-border)] text-xs">
    <div className="text-slate-300 font-medium">{userName}</div>
    <div className="text-slate-500 truncate">{userEmail}</div>
    {clubName && <div className="text-amber-500 mt-1">{clubName}</div>}
    <form action={signOutAction}>
      <button type="submit" className="text-slate-500 hover:text-amber-500 text-xs mt-2">
        Sign out
      </button>
    </form>
  </div>
)}
```

Update the type signature accordingly.

- [ ] **Step 14: Verify locally**

Set `AUTH_ALLOWED_EMAILS="cashier@dev.local,richard.ujadu@gmail.com"` in `.env`. (You can't actually sign in with `cashier@dev.local` since that's not a real Google account — for local dev you'll use your real Gmail. The cashier@dev.local entry is mostly there so if you reseed the dev DB it doesn't lock you out.)

Make sure your `.env` has:

```
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
AUTH_SECRET=...
AUTH_ALLOWED_EMAILS=cashier@dev.local,richard.ujadu@gmail.com
```

Then:

```bash
npm run dev
```

Visit `http://localhost:3000/live`. Expected redirect to `/auth/signin`. Click "Sign in with Google" — sign in with `richard.ujadu@gmail.com` → redirected to `/live`. Verify nav sidebar shows your name + email + "Dev Cardroom" club name.

Try signing out — should redirect to `/auth/signin`.

- [ ] **Step 15: Run all tests**

```bash
npm test
```

Expected: all tests still pass. The `getActiveUser()` helper falls back to `TEST_USER_EMAIL` in tests, and `test-cashier@dev` exists from the updated seed in Task 1.

If any test that exercises the request layer fails because middleware tries to redirect, exclude `/api/auth/*` and any test endpoints from middleware (the matcher already does this — confirm).

- [ ] **Step 16: Commit**

```bash
git add lib/auth.ts lib/active-user.ts app/api/auth app/auth middleware.ts app/\(cashier\)/_actions/_cashier.ts app/\(cashier\)/_actions/session.ts app/\(cashier\)/layout.tsx components/nav-sidebar.tsx tests/unit/auth/ package.json package-lock.json
git commit -m "feat(auth): NextAuth v5 + Google OAuth + email allowlist + auth-derived active user"
```

---

## Task 3: Provisioning scripts

**Files:**
- Create: `scripts/provision-club.ts`
- Create: `scripts/add-member.ts`
- Create: `tests/unit/scripts/provision-club.test.ts`
- Create: `tests/unit/scripts/add-member.test.ts`

These CLIs are documented in `docs/superpowers/specs/2026-05-06-multi-tenant-roadmap.md` Section 5. They're how new clubs and new members get added in stripped-down Phase B (no UI yet). Plan 2c builds them as ready for use; Phase A actually exercises them.

`provision-club.ts` is also useful right now — Task 4 uses it to seed The Office's prod data.

- [ ] **Step 1: Write the provision-club test (failing)**

Create `tests/unit/scripts/provision-club.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";
import { provisionClub, ProvisionClubError } from "@/scripts/provision-club";

describe("provisionClub", () => {
  beforeEach(resetDatabase);

  it("creates a Club + Owner User + ClubMembership + SystemSettings", async () => {
    const result = await provisionClub({
      name: "Joey's Cardroom",
      slug: "joeys",
      ownerEmail: "joey@joeys-cardroom.com",
      ownerName: "Joey Mendoza",
    });

    expect(result.club.slug).toBe("joeys");
    expect(result.club.name).toBe("Joey's Cardroom");
    expect(result.user.email).toBe("joey@joeys-cardroom.com");
    expect(result.membership.role).toBe("OWNER");

    const settings = await testPrisma.systemSettings.findFirst({ where: { clubId: result.club.id } });
    expect(settings).not.toBeNull();
  });

  it("rejects a duplicate slug", async () => {
    await provisionClub({ name: "Friend's", slug: "friends", ownerEmail: "f@x.com", ownerName: "F" });
    await expect(
      provisionClub({ name: "Other Friends", slug: "friends", ownerEmail: "g@x.com", ownerName: "G" })
    ).rejects.toBeInstanceOf(ProvisionClubError);
  });

  it("rejects when an existing User has a different active membership", async () => {
    // The test User "test-cashier" already has a membership at "test-club" via the seed.
    await expect(
      provisionClub({ name: "Other Club", slug: "other", ownerEmail: "test-cashier@dev", ownerName: "Test Cashier" })
    ).rejects.toBeInstanceOf(ProvisionClubError);
  });
});
```

- [ ] **Step 2: Run, see fail**

```bash
npm test -- tests/unit/scripts/provision-club.test.ts
```

Expected: FAIL — module `@/scripts/provision-club` not found.

- [ ] **Step 3: Implement provision-club**

Create `scripts/provision-club.ts`:

```ts
import { PrismaClient, ClubMembershipRole } from "@prisma/client";
import { parseArgs } from "util";

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
    // Validate slug
    if (!/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) {
      throw new ProvisionClubError(`Invalid slug "${args.slug}" — must be lowercase alphanumeric with optional hyphens`);
    }

    // Reject duplicate slug
    const existing = await prisma.club.findUnique({ where: { slug: args.slug } });
    if (existing) throw new ProvisionClubError(`Club with slug "${args.slug}" already exists`);

    // Reject if user already has an active membership somewhere
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
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email: args.ownerEmail,
            name: args.ownerName,
            role: "CASHIER",
            status: "ACTIVE",
            clubId: club.id,
          },
        }));
      // If user already existed without membership, attach them to this club as their primary
      if (existingUser) {
        await tx.user.update({ where: { id: user.id }, data: { clubId: club.id } });
      }
      const membership = await tx.clubMembership.create({
        data: { userId: user.id, clubId: club.id, role: ClubMembershipRole.OWNER, status: "ACTIVE" },
      });
      await tx.systemSettings.create({ data: { clubId: club.id } });

      return {
        club: { id: club.id, name: club.name, slug: club.slug },
        user: { id: user.id, email: user.email, name: user.name },
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
```

Each `SystemSettings` row is keyed on `clubId` (unique) per Task 1's schema change. The `tx.systemSettings.create({ data: { clubId: club.id } })` above creates a fresh per-club settings row.

- [ ] **Step 4: Run the test, see it pass**

```bash
npm test -- tests/unit/scripts/provision-club.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Write the add-member test**

Create `tests/unit/scripts/add-member.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";
import { addMember, AddMemberError } from "@/scripts/add-member";
import { provisionClub } from "@/scripts/provision-club";

describe("addMember", () => {
  beforeEach(resetDatabase);

  it("adds a brand-new User to an existing Club", async () => {
    await provisionClub({ name: "Joey's", slug: "joeys", ownerEmail: "joey@x.com", ownerName: "Joey" });
    const r = await addMember({ clubSlug: "joeys", email: "alex@x.com", name: "Alex Patel", role: "CASHIER" });
    expect(r.user.email).toBe("alex@x.com");
    expect(r.created).toBe(true); // user was newly created
    expect(r.membership.role).toBe("CASHIER");
  });

  it("reuses an existing User row when the email already exists", async () => {
    await provisionClub({ name: "Friends", slug: "friends", ownerEmail: "alex@x.com", ownerName: "Alex" });
    await provisionClub({ name: "Joey's", slug: "joeys", ownerEmail: "joey@x.com", ownerName: "Joey" });

    const r = await addMember({ clubSlug: "joeys", email: "alex@x.com", name: "Alex Patel", role: "CASHIER" });
    expect(r.created).toBe(false); // user already existed
    const user = await testPrisma.user.findUnique({ where: { email: "alex@x.com" }, include: { memberships: true } });
    expect(user?.memberships).toHaveLength(2); // Friends + Joey's
  });

  it("rejects adding a duplicate membership at the same club", async () => {
    await provisionClub({ name: "Joey's", slug: "joeys", ownerEmail: "joey@x.com", ownerName: "Joey" });
    await expect(
      addMember({ clubSlug: "joeys", email: "joey@x.com", name: "Joey", role: "OWNER" })
    ).rejects.toBeInstanceOf(AddMemberError);
  });

  it("rejects when the club slug doesn't exist", async () => {
    await expect(
      addMember({ clubSlug: "nonexistent", email: "alex@x.com", name: "Alex", role: "CASHIER" })
    ).rejects.toBeInstanceOf(AddMemberError);
  });
});
```

- [ ] **Step 6: Run, see fail**

```bash
npm test -- tests/unit/scripts/add-member.test.ts
```

Expected: FAIL — `@/scripts/add-member` not found.

- [ ] **Step 7: Implement add-member**

Create `scripts/add-member.ts`:

```ts
import { PrismaClient, ClubMembershipRole } from "@prisma/client";
import { parseArgs } from "util";

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

      // Check for duplicate membership
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
        user: { id: user.id, email: user.email, name: user.name },
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
      role: { type: "string" }, // OWNER | ADMIN | CASHIER | RUNNER
    },
  });
  if (!values.club || !values.email || !values.name || !values.role) {
    console.error("Usage: add-member.ts --club <slug> --email <email> --name <Name> --role <ROLE>");
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

- [ ] **Step 8: Run the tests, see them pass**

```bash
npm test -- tests/unit/scripts
```

Expected: PASS (7/7 across both files).

- [ ] **Step 9: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add scripts/provision-club.ts scripts/add-member.ts tests/unit/scripts/
git commit -m "feat(scripts): provision-club + add-member CLIs for club provisioning"
```

---

## Task 4: Production cutover + onboarding doc

**This task touches production data — wipes Neon and reseeds with The Office's real values.** The user must run all destructive commands themselves; the implementer/agent surfaces the exact commands but does NOT execute them.

**Files:**
- Create: `docs/ALEX_ONBOARDING.md`

**User actions** (in this order):

- [ ] **Step 1: Verify everything works locally with Plan 2c code**

```bash
npm test          # all green
npm run build     # compiles cleanly (the audit-chip-float.ts script doesn't typecheck-fail anymore since Task 1 in Plan 1c cleanup)
```

Open `http://localhost:3000`, sign in with your Gmail, run a quick session (open → buy-in → close). Confirm the new auth flow works end-to-end on local before going to prod.

- [ ] **Step 2: Update Vercel env vars with The Office's seed values**

In **Vercel → rakeledger project → Settings → Environment Variables**, add (Production + Preview environments, sensitive OFF, no quotes around values):

```
SEED_CLUB_NAME              = The Office
SEED_CLUB_SLUG              = the-office
SEED_OWNER_EMAIL            = theofficetustin@gmail.com
SEED_OWNER_NAME             = Alex Chavez
SEED_DEFAULT_GAME_NAME      = Wednesday Night Poker
SEED_SKIP_SAMPLE_STAFF      = true
```

(`SEED_SKIP_SAMPLE_STAFF=true` so The Office's prod DB doesn't get Dealer Jake / Dealer Anna / Waitress Lila — Alex can add real staff via the Staff page after first sign-in.)

- [ ] **Step 3: Push the Plan 2c code to GitHub**

```bash
git push
```

Vercel auto-builds and redeploys with the new code. Wait for the build to complete (~2 min). Don't visit the URL yet — the prod DB still has the old schema (no Club table) so it'll error.

- [ ] **Step 4: Migrate the prod DB**

```bash
npx dotenv -e .env.production -- npx prisma migrate deploy
```

Adds the new migration on top of the existing prod schema. **This is non-destructive** — it only adds new tables and nullable columns.

- [ ] **Step 5: Wipe + reseed the prod DB**

This destroys the smoke test data from the production verification we did earlier. The user must run this themselves and respond to Prisma's safety prompt:

```bash
npx dotenv -e .env.production -- npx prisma migrate reset --force
```

Prisma will refuse if invoked from an AI agent unless `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` is set. The user runs this in their own terminal so the safety mechanism is satisfied by their direct execution.

After reset, `prisma migrate reset` automatically runs `prisma db seed`, which uses the SEED_* env vars in `.env.production` to create:
- Club: "The Office" (slug: "the-office")
- User: "Alex Chavez" (email: theofficetustin@gmail.com, role: CASHIER, clubId: <the-office>)
- ClubMembership: Alex → The Office, role: OWNER, status: ACTIVE
- SystemSettings: clubId = <the-office>

**Important:** the user's local `.env.production` must have `SEED_CLUB_NAME`, `SEED_OWNER_EMAIL`, etc. set to The Office's real values. Add these now if not already there:

```
SEED_CLUB_NAME="The Office"
SEED_CLUB_SLUG="the-office"
SEED_OWNER_EMAIL="theofficetustin@gmail.com"
SEED_OWNER_NAME="Alex Chavez"
SEED_DEFAULT_GAME_NAME="Wednesday Night Poker"
SEED_SKIP_SAMPLE_STAFF="true"
```

- [ ] **Step 6: Smoke test the deployed app**

Visit `https://rakeledger.vercel.app`. Expected:

1. Redirected to `/auth/signin`
2. Click "Sign in with Google"
3. Sign in as `richard.ujadu@gmail.com` (allowed via AUTH_ALLOWED_EMAILS)
4. **Expected error**: AccessDenied — because there's no User row for `richard.ujadu@gmail.com` in the prod DB (Alex is the only seeded user)

This is the correct behavior. To allow yourself in for testing, run from local:

```bash
npx dotenv -e .env.production -- npx tsx scripts/add-member.ts --club the-office --email richard.ujadu@gmail.com --name "Richard Ujadu" --role ADMIN
```

Now retry sign-in. You should land on `/live` showing "The Office" in the nav and "No session open."

Test as Alex too: Have Alex sign in with `theofficetustin@gmail.com` to confirm her account works. (You probably need to add a temporary test password / dev session for this OR just have Alex confirm sign-in works during onboarding.)

- [ ] **Step 7: Write Alex's onboarding doc**

Create `docs/ALEX_ONBOARDING.md`:

```markdown
# RakeLedger — Welcome to The Office

This is your nightly session and reconciliation tool. Replaces the spreadsheet.

## Sign in

1. Go to **https://rakeledger.vercel.app**
2. Click **Sign in with Google**
3. Use your **theofficetustin@gmail.com** account

If sign-in fails with "Access denied" — message Richard.

## A typical night

### Open the session
Click **Open Session** with whatever cash is in the drawer (small bills for change).

### Record buy-ins as players arrive
Click **+ Buy-in**, pick the player, enter amount, choose method. A toast confirms.
- New player? Click **Players → New Player** first.
- New table? Click **Tables → Add**.

### Other actions during the night
- **+ Rake**: dealer brings rake chips → enter dealer + amount.
- **+ Tip drop**: dealer brings tip chips → enter dealer + amount.
- **$ Marker**: lend a player chips on credit. Repay later from the same modal.
- **− Cash-out**: player leaves → enter their stack as a single total amount.
  - If you'd rather count by chip denomination (e.g., 5 × $100 + 3 × $25), flip the toggle in **Settings**.

### Made a mistake?
Click **correct** on the row in the transaction stream. Pick what to change (method, amount, player, etc.) — the system reverses the original and re-records the corrected version automatically. The original stays for audit.

### Close the night
Click **Close session…** at the top right and walk through the 6 steps:
1. Pay tips
2. Distribute house tax (rare)
3. Distribute rake (per game) to host(s)
4. Resolve chip float — for each player still holding chips:
   - Click **Mark walked** if they left with chips
   - Click **✗ Busted** if they lost their chips to other players (no walk needed)
   - Or click **Auto-attribute** to pro-rata the remaining variance
5. Pre-close diagnostics — sanity check anomalies
6. Reconcile accounts — count the drawer + chips, click **Close Session**

## Click a player or staff name
On the live dashboard, **click any player or dealer name** to open their session activity (every transaction tied to them, plus running totals). Useful for double-checking a buy-in entered correctly.

## Settings (bottom of left sidebar)
Currently one toggle: **Chip denomination grid for cash-outs**.
Off by default — cash-outs are entered as a single total. Turn on if you'd rather count chips by denomination.

## Need help?
Message Richard. Screenshot whatever's confusing and he'll help.
```

- [ ] **Step 8: Commit + push**

```bash
git add docs/ALEX_ONBOARDING.md
git commit -m "docs: ALEX_ONBOARDING.md — Plan 2c onboarding"
git push
```

- [ ] **Step 9: Send Alex the URL + doc**

Brief text/email/Discord/etc. Sample:

> Hey Alex — RakeLedger is live. Replace the spreadsheet on Wednesday and let me know how it goes:
>
> URL: https://rakeledger.vercel.app
> Sign in with: theofficetustin@gmail.com
> Quick start: https://github.com/rjxxl/rakeledger/blob/master/docs/ALEX_ONBOARDING.md
>
> Hit me up with any errors or "wait, how do I…"

---

## Final verification

After Task 4 finishes:

- [ ] Branch merged to master
- [ ] Production URL serves the auth-gated app
- [ ] Alex can sign in at the URL
- [ ] All 68+ unit tests still pass
- [ ] No console errors on `/live` after sign-in
- [ ] User identity widget visible in nav with "The Office" club name
- [ ] Sign-out works
- [ ] Pre-existing playtest data on Neon DB has been wiped (verify by signing in and confirming no residual sessions/players from the Phase 1 smoke test)

---

## Self-review notes

- **Spec coverage:** all four phases of Plan 2c locked-in scope are addressed: auth (Task 2), schema multi-tenant prep (Task 1), provisioning scripts (Task 3), production cutover (Task 4).
- **Type consistency:** `Club`, `ClubMembership`, `ClubMembershipRole`, `ClubMembershipStatus`, `ProvisionClubArgs`, `AddMemberArgs` defined once and reused.
- **Test discipline:** Tasks 1, 3 follow TDD. Task 2 has a small TDD step for the allowlist (the rest is integration code that's verified by manual smoke + existing test suite passing).
- **No placeholders:** every code block is concrete; commands are exact; the production cutover steps spell out the exact `dotenv-cli` invocations.
- **Production safety:** Task 4's destructive commands (`migrate reset`) are explicitly user-run, not agent-run. The implementer subagent should NOT attempt these — they're documented as user actions.
- **SystemSettings refactor:** the existing model uses `Int @id @default(1)` (singleton). Task 1 explicitly replaces this with `String @id @default(cuid())` + `clubId @unique` so each club gets its own settings row. This is a destructive schema change for the existing dev DB seed — handled by the migration + seed reset.
