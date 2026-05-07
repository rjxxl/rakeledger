# Multi-Tenant Roadmap & Plan 2c Decisions

**Date:** 2026-05-06
**Status:** Strategy lock-in. Implementation phased over 3-12 months as pull from real users grows.
**Context:** RakeLedger is currently single-tenant (built for one friend's card room). The original spec (`2026-05-03-rakeledger-design.md` §1) flagged "other small private clubs could adopt it" as eventual goal. After production deploy (Plan 2c), the user identified at least one second room interested in using the tool, motivating a phased move toward multi-tenant SaaS.

---

## 1. Current state (single-tenant)

Every model in `prisma/schema.prisma` implicitly belongs to one club:

- No `Club` / `Organization` entity
- `Session`, `Player`, `User`, `Table`, `Game`, `Marker`, `SystemSettings`, `Transaction` all assume single-tenancy
- Cashier hardcoded as `cashier@dev.local` via `lib/auth-derived equivalents`
- Settings are localStorage-scoped (browser per-device), not per-club
- ~30-40 Prisma queries scope by `sessionId` only — none scope by tenant

The app *works* for one room. It would *break* if a second room's data were added to the same DB without tenant scoping.

---

## 2. Phased breakdown (full SaaS)

| Phase | Scope | Estimate |
|-------|-------|---------:|
| **A** | Schema multi-tenancy: `Club` model, `clubId` FK on every scoped model, migration for existing rows, every query refactored to filter by `clubId` | 1-2 weeks |
| **B** | Auth that resolves to a club: Google OAuth (NextAuth/Auth.js v5), `ClubMembership` join, active-club cookie, middleware enforcement, capability/role system | 1-2 weeks |
| **C** | Sign-up + onboarding: public landing, sign-up flow, "create your club" form, invite flow with role assignment, club-switcher UI | 1 week |
| **D** | Per-club configuration: settings UI for rake split rules, tip tax, table list, dealer roster, payment methods, branding | 1-2 weeks |
| **E** | Tenancy URL & billing: subdomain vs path tenancy decision, Stripe integration if paid, platform-admin dashboard | 2-4 weeks |
| **F** | Marketing surface: landing page, pricing, docs, support channel | 1-2 weeks |

**Total focused: 2-3 months.**

---

## 3. Pragmatic path (locked in)

Don't build all of A-F up front. Pull each phase from real user demand:

1. **Ship 2c (single-tenant, friend only).** Validate the tool works in production for one room. Iterate on real cashier feedback for 1-3 months. ← **Plan 2c**
2. **When a second room organically asks** ("hey, can my buddy's room use this?"), do **just** Phase A + a stripped-down B (no public sign-up; provision clubs manually via CLI). Now it's "multi-tenant for two rooms."
3. **When 3-5 rooms** are running stably, do C and D (real sign-up + per-club config). Now it's a self-serve product.
4. **When 10+ rooms or a paying customer pushes for it,** do E (billing + subdomains) and F (marketing). Now it's a SaaS.

**Locked-in commitment (2026-05-06):** the user can already see a second room interested. Steps 1 AND 2 will both happen. Step 1 (Plan 2c, single-tenant) ships first. Step 2 (Phase A + stripped-down B) starts as soon as Plan 2c is stable.

---

## 4. Implication for Plan 2c

Because Step 2 is committed, Plan 2c will use a "future-proofed" approach instead of bare-bones:

| Choice | Bare-bones option | Future-proofed option (chosen) | Why |
|--------|-------------------|--------------------------------|-----|
| Auth | Basic-auth middleware (single shared password) | **NextAuth + Google OAuth, gated to email allowlist** | Adding NextAuth on top of basic-auth later means redoing the wedge. Doing it now lets Phase B reuse the same auth stack. |
| Schema | No changes; rely on single-tenant assumption | **Add `Club` model + nullable `clubId` columns; default everyone to a single seeded "Friend's Club" row** | The Phase A query refactor becomes a `WHERE clubId = ?` instead of touching 40+ files. Migration is small. |

**Estimated extra effort:** ~half a day in Plan 2c. **Estimated time saved:** ~2 weeks in Phase A.

The Plan 2c implementation prompt should include both choices as concrete schema/code requirements.

---

## 5. How "stripped-down B" works (provisioning a second room manually)

When the second room is ready to onboard, the platform owner (you) provisions them manually — no public sign-up UI yet. The mechanics:

### One-time setup the second room needs

- A Google account they're willing to use for sign-in (their email)
- The production URL (`rakeledger.club` or `*.vercel.app`)

### Steps you take

1. **Run a provisioning script** (built in Phase A):

   ```bash
   npx tsx scripts/provision-club.ts \
     --name "Joey's Cardroom" \
     --slug joeys \
     --owner-email joey@joeys-cardroom.com \
     --owner-name "Joey Mendoza"
   ```

   The script:
   - Creates a `Club` row (id, name, slug)
   - Creates a `User` row with `email = joey@…`, `status = ACTIVE`, `role = OWNER`
   - Creates a `ClubMembership` row linking the user to the club with the OWNER role
   - Seeds the club's `SystemSettings` row with default rake/tax rates
   - Optionally creates a default `Game` and `Table` so they can start immediately
   - Prints the club's slug and the user's email

2. **Send Joey a one-line message:**

   > "Go to `rakeledger.club`, click 'Sign in with Google', use `joey@joeys-cardroom.com`. You'll land on your club's dashboard."

3. **Joey signs in:**
   - Clicks "Sign in with Google" on the landing page
   - Google completes OAuth, returns the email `joey@…`
   - NextAuth's session callback looks up the existing User row by email, attaches their `userId` and `clubId` to the session
   - Middleware redirects them to `/live`
   - Every query they make is filtered by their `clubId` — they only ever see Joey's Cardroom data

4. **Joey adds his team** — at this stage there's no invite UI yet (Phase C), so he tells you "add my cashier Alex (alex@…) and dealer Maria (maria@…)" and you run a separate `add-member.ts` script (next subsection).

### Adding members to an existing club (`add-member.ts`)

After a club exists, individual staff additions go through a smaller script. This is the workhorse you'll run more often than `provision-club.ts` — once per new staff member at any club.

```bash
npx tsx scripts/add-member.ts \
  --club joeys \
  --email alex@gmail.com \
  --name "Alex Patel" \
  --role CASHIER
```

The script:

1. Looks up the `Club` by slug (errors clearly if not found)
2. Looks up the `User` by email
3. **If the user does NOT exist yet** (this is Alex's first club): creates the `User` row, then the `ClubMembership`
4. **If the user already exists** (Alex already works at Friend's): creates only a new `ClubMembership { userId: alex_xyz, clubId: joeys, role: CASHIER }`. The existing User row is reused — same name, same email, same `userId` everywhere
5. Prints what it did so you can confirm

Either way, Alex can sign in immediately on her next visit and the new club shows up in her picker.

### The same-cashier-at-multiple-clubs case

The schema's `User`/`ClubMembership` split handles this naturally: one human, one Google account, one `User` row, multiple `ClubMembership` rows. Alex working at both Friend's Cardroom and Joey's Cardroom looks like:

```
User { id: alex_xyz, email: alex@gmail.com, name: "Alex Patel" }

ClubMembership { userId: alex_xyz, clubId: friends, role: CASHIER, status: ACTIVE }
ClubMembership { userId: alex_xyz, clubId: joeys,   role: CASHIER, status: ACTIVE }
```

**Sign-in flow with multiple memberships:**

1. Alex clicks "Sign in with Google" → Google returns `alex@gmail.com`
2. NextAuth looks up the User and reads her memberships
3. Branches on count:
   - One membership → auto-select, land on `/live`
   - Multiple → show a club picker, Alex selects one, that club becomes "active" in the session cookie, land on `/live`
4. A small dropdown in the nav header lets Alex switch the active club mid-shift without re-authenticating

**What's per-club vs per-user:**

| Thing | Scope |
|-------|-------|
| Sessions, players, transactions, ledger entries | Per-club. Alex at Friend's cannot see Joey's data even with manipulated URLs (middleware enforces club membership before queries run). |
| Audit `createdById` on transactions | Same `userId` regardless of club. Friend's owner sees "recorded by Alex" only on Friend's transactions; Joey's owner sees the same Alex on Joey's transactions. |
| Display name | One `User.name`. Both clubs see the same name. (Per-club display name override can be added to `ClubMembership` later if anyone needs it.) |
| Role & capabilities | Per-club via `ClubMembership.role`. Alex can be CASHIER at one club and OWNER at another. |
| Active in-progress session | Per-club. Alex switching clubs mid-shift leaves the other club's session open and unchanged. |

**Edge cases:**

- **Role revoked at one club** (Alex quits Friend's): `ClubMembership.status = "REMOVED"`. Friend's drops off her picker; Joey's stays. Audit history at Friend's still references her by `userId` — not deleted.
- **Mistaken-club entry risk**: Alex switches to Joey's at noon, forgets, starts entering buy-ins for Friend's players into Joey's session at 4pm. The system can't prevent this. Mitigations to design into Phase D: prominent club name in the nav header (color-coded?), confirmation prompt on opening a session ("Open new session for **Joey's Cardroom**?").
- **Dealers/waitresses at multiple clubs** (no app login, just receive tip payouts): same model. `User { role: DEALER }` row + memberships at each club. They never sign in, but tip payouts at each club are correctly attributed to their `userId`.

### Why this works without a sign-up UI

Google OAuth handles authentication (proving the user is who they say). Your scripts handle **provisioning** (deciding who's allowed in and which club they belong to). There's no password to manage, no email verification flow to build, no invite tokens — Google does identity, you do authorization.

### What's missing (deferred to Phase C)

- No self-serve sign-up: Joey can't onboard himself; you run `provision-club.ts`
- No invite flow: Joey can't add Alex; you run `add-member.ts`
- No password reset: irrelevant — Google handles it
- No public landing page: visitors hitting the URL just see the sign-in screen
- No "edit my display name" UI: changes to `User.name` go through Prisma Studio or a one-off script

That's all fine for 2-5 rooms. When you have 5+ rooms or one of them needs to onboard a teammate without you in the loop, build Phase C.

---

## 6. Open questions for later

- **URL strategy** (Phase E): subdomain (`<club>.rakeledger.com`), path (`rakeledger.com/<club>`), or session-cookie-only (`rakeledger.com` resolves the active club from the user's session)? Each has trade-offs in DNS complexity, SEO, branding, and link-shareability. Defer until Phase E.
- **Pricing model**: free + open source, $X/month per club, per-session metered, or freemium with paid tier for owner dashboards/exports? Defer until 5+ paying-eligible rooms exist.
- **Compliance positioning**: "private social game accounting tool" framing keeps the surface area narrow. Avoid anything that looks like enabling "for-profit gambling operations." Worth a brief read on state/country laws if and when a real customer is in a jurisdiction with strict rules.
- **Operational support model**: who handles tickets when the platform has 10+ clubs? Email-only, Discord community, or paid support tier? Defer until support load justifies it.
- **Data isolation guarantees**: same-database multi-tenant (current path) is simpler but has small risk of query bugs leaking data between clubs. Schema-per-tenant or DB-per-tenant is safer but more operational overhead. Stay with same-database + good test coverage of the `clubId` filter on every query unless a customer demands isolation.

---

## 7. Acceptance criteria for "Step 2 done"

When Phase A + stripped-down B is complete, this should be true:

**Schema & data**
- [ ] `Club` model exists with at least one row ("Friend's Cardroom")
- [ ] `ClubMembership` join table exists with `userId`, `clubId`, `role`, `status` columns
- [ ] Every scoped model (`User`, `Session`, `Player`, `Table`, `Game`, `Marker`, `SystemSettings`, `Transaction`) has a `clubId` FK populated for all existing rows
- [ ] Every query in the app filters by the active user's `clubId`

**Provisioning scripts**
- [ ] `scripts/provision-club.ts` creates a new Club + owner User + ClubMembership + default SystemSettings + (optional) default Game/Table in one transaction
- [ ] `scripts/add-member.ts` adds a User to an existing Club:
  - Creates the User row if email doesn't exist
  - Reuses the existing User row if email does exist (the "same cashier at multiple clubs" case)
  - Always creates a new ClubMembership row scoped to the target club + role

**Multi-tenant correctness**
- [ ] Two users from different clubs cannot see each other's data — verified by a test that creates two clubs, adds different transactions to each, signs in as each user, and asserts they can only read their own club's rows
- [ ] A user with memberships at multiple clubs sees a club picker on sign-in (or auto-routes if exactly one membership)
- [ ] Switching active club via the nav dropdown updates the session cookie and revalidates the page
- [ ] Cross-club leak is prevented at the middleware layer, not just the query layer (defense in depth) — verified by a test that crafts a request with a club-mismatched URL parameter and asserts a 403/redirect before any query runs

**Auth**
- [ ] Sign-in via Google OAuth works for users at any club
- [ ] An email NOT present in the User table cannot sign in (provisioning is required first)
- [ ] A `ClubMembership.status = "REMOVED"` membership is filtered out of the picker but the User row + audit history remain intact
