# RakeLedger — Onboarding for The Office

Hey Alex — here's the cliff notes for getting started. Should take about 5 minutes to read, then you can poke at the app and I'll be on standby for questions.

**App URL:** https://rakeledger.vercel.app

---

## 1. Signing in

Click **Sign in with Google** and use **theofficetustin@gmail.com**. Only that email is currently authorized — anyone else who tries gets bounced. (If you want to add another login later, see [Section 5](#5-managing-who-can-sign-in).)

After sign-in you land on the Live Session page. The sidebar's bottom-left shows your name, email, and the club you're managing ("The Office"). If anything ever looks wrong there, sign out and sign back in.

---

## 2. First-time setup (do this once, before your first night)

> **Heads up:** Staff, players, tables, and members all persist forever — closing a session doesn't wipe them. Add Dealer Marcus once and he's there every night until you disable him. Same for players, members, and table layouts. Only session-level data (transactions, the open/close, the host selection) resets each night.

### Add your staff

Click **Staff** in the sidebar → **+ Add staff**. Add a row for every dealer, waitress, runner, and host who works your room. You can add staff entries even for people who don't have email accounts — these aren't logins, just names the system uses for tip payouts and host distributions.

Roles you'll pick from:
- **DEALER** — gets a tip payout at end of night
- **WAITRESS** — gets a tip payout at end of night (excluded from rake/house-tax)
- **RUNNER** — floor staff; can be selected as a host at session close
- **CASHIER / ADMIN / OWNER** — only for people who'll log in and operate the cash desk

### Tip tax rate (optional)

The default tip tax is **20%** — that slice gets withheld from each staff member's tip payout and pooled into the **House Tax pool**, which you (and any hosts) split at end of night. If you want a different default for the whole club, or per-staff overrides, ping me and I'll set it in the database (no UI for this yet).

---

## 3. A typical night

### Start of shift

**Live Session** → enter your **opening cash float** (the small bills you keep in the drawer for change) → click **Open Session**. The session is now live and every transaction below gets logged to it.

### During the night, use Quick Actions

| Action          | When                                                                                    |
|-----------------|-----------------------------------------------------------------------------------------|
| **+ Buy-in**    | A player gives you cash for chips. Pick the player, enter the amount.                  |
| **− Cash-out**  | A player wants to leave and turn chips back into cash.                                 |
| **+ Rake**      | You pull rake chips out of a pot. Optionally tag the dealer/table.                     |
| **+ Tip drop**  | A dealer or waitress brings their accumulated tip chips to the cage.                   |
| **$ Marker**    | You extend credit ("a marker") to a player. They'll pay it back later.                 |
| **🏆 Jackpot** / **🎁 Freeroll** | Special-purpose payouts.                                              |
| **Tournament**  | Tournament fees in / payouts out.                                                       |
| **··· Other**   | Misc adjustments (chip float corrections, F&B costs, staff advances, etc.).            |

The transaction stream on the left fills up as you go. Every entry shows the time, who recorded it, the amount, and the affected accounts.

### End of shift

Click **Close session…** in the top-right. Six steps walk you through wrapping up:

1. **Pay out tips** — for each dealer/waitress, the system shows their total tip pool, deducts the 20% tax, and you record the net payout (cash, Zelle, Venmo, etc.).
2. **Distribute house tax pool** — the accumulated tax (from Step 1) gets split among **tonight's hosts** (see [Section 4](#4-hosts-working-tonight)).
3. **Distribute rake** — the rake pool, per game, also goes to tonight's hosts.
4. **Resolve chip float** — match outstanding "walks" (players who left with chips) against returns.
5. **Pre-close diagnostics** — the system flags anything weird (e.g., a transaction that looks like it might be a duplicate).
6. **Reconcile and close** — count the actual cash + payment-app balances, enter what you counted, and the system records the variance from what it expected. Variances are allowed — they just get logged.

---

## 4. Hosts working tonight

When you reach **Step 2** of close-session, you'll see a checklist labeled **"Hosts working tonight"**. It lists every staff member in your club (except waitresses).

**Check the box next to every person who actually hosted the room tonight.**

Whoever you check splits both the **House Tax pool** AND the **Rake pool**. The system pre-fills an even split, but you can edit each row's amount if you split unevenly that night.

Three things to know:
- **You're not auto-included.** If you're not hosting that night, don't check yourself.
- **Selection saves automatically.** If you refresh the page mid-close, your checks are still there.
- **A dealer/runner can also be a host** for a given night — just check them. If a dealer is checked as a host AND received a tip payout in Step 1, they'll get both. The system won't stop you, so be intentional.

---

## 5. Managing who can sign in

Click **⚙ Settings** in the sidebar → **Members**. (You'll see this section because you're the OWNER. Cashiers without admin role won't see it.)

### Adding someone

**+ Add member** → enter their email, display name, and role:

- **CASHIER** — can run the cash desk (open sessions, record transactions, close sessions). Most logins will be this.
- **ADMIN** — can do everything CASHIER can, plus add/edit/revoke other members.
- **RUNNER** — currently has the same permissions as CASHIER but is intended for floor staff. (Future versions may restrict this.)
- **OWNER** — full access, including revoking other OWNERs. Only OWNERs can grant OWNER. Don't add this unless you really mean it.

### Revoking access

Click **Revoke** on the member's row → confirm. They lose access **on next sign-in**. If they're already signed in elsewhere, their session stays valid until it expires (up to 30 days). For an immediate hard cut, message me — I can rotate the auth secret which signs everyone out instantly.

### Re-adding someone

Click **Show removed (N)** at the bottom of the members list to see past members. Hit **Re-add** to restore their access (with whatever role they had before). Their User ID stays the same so all their historical transactions still resolve to them in the audit log.

### One safety rule

You can't revoke the last OWNER of the club (you, by default). If you ever need to step down, promote someone else to OWNER first, *then* demote/revoke yourself.

---

## 6. The audit log

Every transaction is permanent. Even "corrections" don't overwrite — they create a new offsetting entry that points back to the original. If something looks wrong on a closed session, don't try to "fix" it by going back to the live page; ping me and I'll help you trace what happened.

---

## 7. When something goes wrong

- **Page won't load / weird error** — refresh once. If still broken, screenshot whatever's on screen and send it to me.
- **Locked out / can't sign in** — message me. The most common cause is the email isn't on the members list, which I can fix in 30 seconds.
- **Transaction recorded wrong** — note the time, the type, and roughly the amount. Don't try to "delete" it; just message me with details and we'll record a correction.
- **Cash drawer doesn't reconcile at close** — that's fine, just enter what you counted. The system records the variance and moves on. We can review variances together later.

---

## 8. What's next

This is **Phase 2** — the foundation. The app is correct and durable but the UI is intentionally bare. Things I'm planning to layer on once you've used it for a few nights:

- Reports (week-by-week, dealer-by-dealer, etc.)
- Player history (lifetime buy-in / cash-out per player)
- Mobile layout polish
- Whatever you ask for after running a few real nights

Use it. Tell me what's annoying. We'll improve it together.

— RJ
