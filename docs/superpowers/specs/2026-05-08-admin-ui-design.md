# Admin UI — Member Management

**Status:** Draft (approved 2026-05-08)
**Author:** Richard Ujadu
**Pre-handoff blocker:** Yes — must ship before Alex Chavez gets the production URL.

## Context

Today, adding a new login to a club requires running `scripts/add-member.ts` from a developer's terminal. Revoking access requires a manual SQL update. Both operations are out of reach for the club owner — Alex would have to text Richard every time he wants to grant or revoke a cashier login. This doesn't scale even at friend-deal volume, and it makes the developer a single point of failure for routine club admin.

Two related issues compound the friction:

1. **The `AUTH_ALLOWED_EMAILS` env-var allowlist gates sign-in before the DB-backed provisioning gate.** Adding a new member to the DB doesn't grant them sign-in unless their email is also added to the env var, which requires a Vercel redeploy. Two sources of truth that can drift; the env-var redeploy step defeats the point of self-service member management.

2. **The sign-in callback in `lib/auth.ts:37-46` only checks `User.status === "ACTIVE"`.** It does not check whether the user has any active `ClubMembership`. A revoked user (membership marked REMOVED) would pass the sign-in gate and land in a "no club" limbo state where the JWT has `clubId: null` and many cashier flows fail with cryptic errors.

This spec replaces the CLI flow with a UI under `/settings/members`, drops the env-var allowlist, and tightens the sign-in callback. It also introduces the first role-based access control gate in the app.

## Goals

- OWNER and ADMIN club members can manage logins from the app: add new members, edit name/role, revoke, re-add.
- The admin UI is the first role-gated route in the app, establishing a pattern for future RBAC additions.
- Removing the env-var allowlist eliminates the source-of-truth drift and the redeploy-on-add friction.
- The sign-in gate becomes precise: ACTIVE User row + at least one ACTIVE ClubMembership.
- Revoking access takes effect best-effort (next sign-in or JWT expiry, max 30 days). The nuclear `AUTH_SECRET` rotation remains available for adversarial cases.

## Non-Goals (YAGNI)

- **Dedicated audit log table.** `ClubMembership.createdAt` and `updatedAt` provide minimal forensic info; a proper audit table can be added when there's a real requirement.
- **Per-request JWT revalidation.** A revoked user keeps their existing session until the JWT expires (≤ 30 days). Acceptable for friend-deal scope; documented caveat.
- **Bulk add / CSV import.** Single-add via UI form is enough for The Office.
- **Email-invite flow.** Adding a member by email implicitly assumes Alex has already coordinated out-of-band with the new cashier.
- **Cross-club membership management.** Current model is one club per user; the admin UI manages a single club's members at a time.
- **Self-service profile editing.** Members can't edit their own name or role; only OWNER/ADMIN can.

## Design

### Schema & data model

**No schema changes.** All needed structure exists:

- `ClubMembership { id, userId, clubId, role, status, createdAt, updatedAt }` — soft-revoke via `status = REMOVED`.
- `User { id, email, name, status, clubId, ... }` — covers the user-level fields the form needs.
- `ClubMembershipRole` enum (OWNER, ADMIN, CASHIER, RUNNER) — covers all assignable login roles.

### Permission matrix

The UI and the server actions enforce these rules. Server-side enforcement is the trust boundary; UI conditional rendering is convenience.

| Action                                  | OWNER | ADMIN | CASHIER / RUNNER |
|-----------------------------------------|-------|-------|------------------|
| View `/settings/members`                | ✅    | ✅    | ❌               |
| Add member as CASHIER / RUNNER          | ✅    | ✅    | ❌               |
| Add member as ADMIN                     | ✅    | ✅    | ❌               |
| Add member as OWNER                     | ✅    | ❌    | ❌               |
| Edit (name/role) of CASHIER / RUNNER    | ✅    | ✅    | ❌               |
| Edit (name/role) of ADMIN               | ✅    | ✅    | ❌               |
| Edit (name/role) of OWNER               | ✅    | ❌    | ❌               |
| Revoke CASHIER / RUNNER                 | ✅    | ✅    | ❌               |
| Revoke ADMIN                            | ✅    | ✅    | ❌               |
| Revoke OWNER                            | ✅    | ❌    | ❌               |
| Re-add a previously revoked member      | (same as Add for that target role)              |
| Revoke yourself (any role)              | ❌    | ❌    | ❌               |

**Invariants:**
- Last-OWNER protection: revoking or demoting the only ACTIVE OWNER of a club is blocked. Alex must promote a successor before he can step down.
- Self-revoke is blocked (any role). Prevents accidental lockout. Members who genuinely want to leave coordinate with another OWNER/ADMIN.

### Routes

```
app/(cashier)/settings/page.tsx              — index page (existing, augmented to link to /settings/members for OWNER/ADMIN)
app/(cashier)/settings/members/page.tsx      — members list (NEW)
app/(cashier)/settings/members/_actions.ts   — server actions (NEW)
app/(cashier)/settings/members/_components/  — modal forms, list rows (NEW)
```

The members route is gated by a server-side check on every request: read the active user's membership, reject if `role NOT IN [OWNER, ADMIN]`. Implementation: a small helper `requireAdmin()` that throws a 403-style error or redirects to `/settings`.

The sidebar's "Settings" link stays visible to everyone. The "Members" sub-link inside the settings index page only renders for OWNER/ADMIN.

### UI shape

**`/settings`** becomes a thin index:

```
Settings
  > Members            (only visible to OWNER/ADMIN)
  > Denominations      (existing)
```

**`/settings/members`** layout:

```
┌─ MEMBERS ─────────────────────────────  [+ Add member] ─┐
│  Alex Chavez       OWNER     alex@…              [Edit] │
│  Richard Ujadu     CASHIER   richard@…   [Edit] [Revoke]│
│  Marcus            CASHIER   marcus@…    [Edit] [Revoke]│
│                                                         │
│  ───── Show removed (1) ▾ ─────                         │
│  Sally             CASHIER   sally@…           [Re-add] │ (faded)
└─────────────────────────────────────────────────────────┘
```

- Default view shows only ACTIVE members; revoked members are collapsed behind a toggle.
- **Add member** opens a modal: email + name + role dropdown. Submit → server action. On success, the modal closes and the list re-renders.
- **Edit** opens a modal: name (editable) + role dropdown (editable, filtered by permissions) + email (read-only).
- **Revoke** is an inline button. Clicking opens a confirm dialog: "Revoke Marcus's access? They'll be signed out within 30 days." Confirm → server action.
- **Re-add** is shown next to revoked members. Clicking opens the same modal as Add, pre-populated with the existing email/name (read-only) and a fresh role choice. Re-using the existing `ClubMembership` row preserves history.
- Permission-aware rendering: ADMIN viewers don't see Edit/Revoke buttons on OWNER rows; the role dropdown excludes OWNER unless the viewer is OWNER.

### Server actions

New file `app/(cashier)/settings/members/_actions.ts`:

```ts
async function addMember(formData: FormData): Promise<void>
async function updateMember(formData: FormData): Promise<void>
async function revokeMember(membershipId: string): Promise<void>
async function reAddMember(membershipId: string, role: ClubMembershipRole): Promise<void>
```

Every action performs the following checks before doing any write:

1. Authenticate via `auth()` and resolve the caller's User and ClubMembership in their active club.
2. Reject if the caller's membership role is not OWNER or ADMIN.
3. Reject if the target's club doesn't match the caller's active club.
4. Reject if the action violates the permission matrix (e.g., ADMIN trying to add OWNER, or anyone trying to revoke themselves).
5. Reject if the action would violate the last-OWNER invariant.
6. Validate input (zod): email format, name non-empty, role in enum.

All write actions wrap the membership mutation in a Prisma transaction. After success, call `revalidatePath('/settings/members')` so the page re-renders with fresh data.

The existing `addMember()` function in `scripts/add-member.ts` already handles "create User if needed, reuse existing User if email matches, create-or-update ClubMembership." The plan extracts that logic to a shared helper at `lib/admin/members.ts` so both the CLI and the UI server action call into the same code path.

### Auth changes (`lib/auth.ts`)

Two changes, both small.

**Change 1: Drop the `AUTH_ALLOWED_EMAILS` allowlist gate.**

Remove:
- The `isEmailAllowed()` helper at `lib/auth.ts:5-9`.
- The gate that calls it inside the `signIn` callback (`lib/auth.ts:40-42`).
- The env-var read in production. (The variable can be cleaned out of `.env`, `.env.production`, `.env.e2e.example` separately; not a code concern, but listed in the implementation plan.)
- Any test in `lib/auth.test.ts` (if exists) that asserts allowlist behavior.

`AUTH_BYPASS_FOR_TESTS=1` is independent and remains untouched.

**Change 2: Add membership-existence check to the sign-in gate.**

Replace `signIn`:

```ts
async signIn({ user }) {
  if (!user.email) return false;
  const dbUser = await prisma.user.findUnique({
    where: { email: user.email },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!dbUser || dbUser.status !== "ACTIVE") return false;
  if (dbUser.memberships.length === 0) return false;
  return true;
}
```

This closes the limbo-state gap: a User row with no active memberships can no longer sign in. Combined with soft revoke (which sets `ClubMembership.status = REMOVED`), revocation now blocks future sign-ins reliably — even though existing JWT sessions remain valid until expiry.

### Revocation semantics

Per Q4/Q6 decisions:

- "Revoke" sets `ClubMembership.status = "REMOVED"`. `User.status` is **not** touched.
- Existing JWT sessions in the revoked user's browser stay valid until expiry (best-effort revoke). The nuclear `AUTH_SECRET` rotation in Vercel env is the escape hatch for adversarial cases.
- Re-adding a revoked member flips the same `ClubMembership` row back to `ACTIVE`, preserving the original `User.id` so all historical transaction `staffId` references still resolve.
- `User.status = "DISABLED"` is reserved for global account-level lockout (currently unused; future feature).

### CLI scripts

- **`scripts/add-member.ts`** — kept as an emergency operator fallback. Refactored to import the shared logic from `lib/admin/members.ts`. README gets a note: "for normal use, manage members at /settings/members; this script is for ops emergencies (UI broken, no OWNER yet, etc.)."
- **`scripts/provision-club.ts`** — unchanged. Still the only path to bootstrap a brand-new club.
- No new revoke CLI; emergency revocation can be a one-line SQL update if absolutely needed.

## Testing

**Unit tests:**
- `lib/admin/members.ts` shared helper:
  - `addMember()`: creates new User + Membership, reuses existing User by email, errors on already-active membership, flips REMOVED → ACTIVE on re-add.
  - `updateMember()`: changes role and name correctly; rejects unknown membership.
  - `revokeMember()`: sets status REMOVED; refuses last-OWNER revoke; refuses self-revoke.
  - `reAddMember()`: flips REMOVED → ACTIVE with the new role.
- `lib/auth.ts` `signIn` callback: rejects email with no User row, rejects DISABLED user, rejects user with no ACTIVE memberships, accepts user with one ACTIVE membership.
- Permission helper `requireAdmin()`: passes for OWNER/ADMIN, rejects for CASHIER/RUNNER, rejects for unauthenticated.

**Integration / E2E:**
- Sign in as OWNER → navigate to `/settings/members` → add a new CASHIER → log out → sign in as the new cashier → land on `/live` correctly.
- Sign in as OWNER → revoke the cashier → log out → attempt to sign in as the revoked cashier → blocked at sign-in with appropriate error UI.
- Sign in as CASHIER → navigate to `/settings/members` → see 403 / redirect to `/settings`.
- Last-OWNER protection: with only one OWNER, attempt revoke → server action rejects, UI shows error toast.

**Cleanup:**
- Test that `AUTH_ALLOWED_EMAILS` removal doesn't break test bypass — test runs that use `AUTH_BYPASS_FOR_TESTS=1` should pass without the env var being set.

## Open questions

None. All design decisions made during 2026-05-08 brainstorm.

## Implementation order (preview)

1. Extract shared member-management logic to `lib/admin/members.ts` (alongside existing `scripts/add-member.ts`, which becomes a thin CLI wrapper).
2. Add `requireAdmin()` helper somewhere appropriate (likely `lib/auth-helpers.ts` or similar).
3. Update `signIn` callback in `lib/auth.ts`: drop allowlist, add membership existence check. Update tests.
4. Remove `AUTH_ALLOWED_EMAILS` from `.env`, `.env.production`, `.env.e2e.example`. (Vercel env stays in place until the new code is deployed — see step 9.)
5. New server actions in `app/(cashier)/settings/members/_actions.ts`.
6. New page `app/(cashier)/settings/members/page.tsx` + components (list, add modal, edit modal, revoke confirm).
7. Augment `/settings/page.tsx` to link to `/settings/members` for OWNER/ADMIN.
8. Tests (unit + E2E).
9. Final pass: remove `AUTH_ALLOWED_EMAILS` from Vercel env after the deploy.
