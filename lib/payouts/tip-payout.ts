import Decimal from "decimal.js";
import { prisma } from "@/lib/db";

export interface TipPayoutRow {
  staffId: string;
  staffName: string;
  staffRole: string;
  total: Decimal;
  taxRate: Decimal;
  calculatedTax: Decimal;
  roundedTax: Decimal;
  netToStaff: Decimal;
}

/** Banker's-style rounding to the nearest whole dollar. Half goes to even. */
function roundHalfToEven(d: Decimal): Decimal {
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
}

/** Returns one row per staff member who has a non-zero tip-pool slice in this session. */
export async function computeTipPayouts(sessionId: string): Promise<TipPayoutRow[]> {
  // Resolve the session's club so the SystemSettings (per-club tip tax) lookup below
  // doesn't leak across tenants. Session.clubId is the source of truth.
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: { clubId: true },
  });

  const tipDrops = await prisma.transaction.findMany({
    where: { sessionId, type: "TIP_DROP", staffId: { not: null } },
    include: { staff: true, ledgerEntries: true },
  });

  const perStaff = new Map<string, { total: Decimal; staffName: string; staffRole: string }>();
  for (const tx of tipDrops) {
    if (!tx.staffId || !tx.staff) continue;
    const existing = perStaff.get(tx.staffId) ?? {
      total: new Decimal(0),
      staffName: tx.staff.name,
      staffRole: tx.staff.role,
    };
    const tipPoolEntry = tx.ledgerEntries.find((e) => e.account === "TIP_POOL");
    if (tipPoolEntry) {
      existing.total = existing.total.add(new Decimal(tipPoolEntry.delta.toString()));
    }
    perStaff.set(tx.staffId, existing);
  }

  if (perStaff.size === 0) return [];

  // Subtract any prior tip_payouts/tip_house_tax for these staff in this session.
  const priorPayouts = await prisma.transaction.findMany({
    where: {
      sessionId,
      type: { in: ["TIP_PAYOUT", "TIP_HOUSE_TAX"] },
      staffId: { in: [...perStaff.keys()] },
    },
    include: { ledgerEntries: true },
  });
  for (const tx of priorPayouts) {
    if (!tx.staffId) continue;
    const existing = perStaff.get(tx.staffId);
    if (!existing) continue;
    const tipPoolEntry = tx.ledgerEntries.find((e) => e.account === "TIP_POOL");
    if (tipPoolEntry) {
      existing.total = existing.total.add(new Decimal(tipPoolEntry.delta.toString()));
    }
  }

  // Per-club tip tax rate. SystemSettings is keyed by clubId post-Plan-2c; we scope explicitly
  // so a second tenant's settings can't leak in. Session.clubId is nullable in the schema only
  // because the multi-tenant migration was additive; for any post-Plan-2c session it's always set.
  const settings = session.clubId
    ? await prisma.systemSettings.findUnique({ where: { clubId: session.clubId } })
    : null;
  const systemDefaultRate = new Decimal((settings?.defaultTipTaxRate ?? 0.20).toString());

  const users = await prisma.user.findMany({
    where: { id: { in: [...perStaff.keys()] }, clubId: session.clubId },
    select: { id: true, tipTaxRate: true },
  });
  const rateByUser = new Map<string, Decimal>();
  for (const u of users) {
    rateByUser.set(u.id, u.tipTaxRate ? new Decimal(u.tipTaxRate.toString()) : systemDefaultRate);
  }

  const rows: TipPayoutRow[] = [];
  for (const [staffId, info] of perStaff.entries()) {
    if (info.total.lessThanOrEqualTo(0)) continue;
    const taxRate = rateByUser.get(staffId) ?? systemDefaultRate;
    const calculatedTax = info.total.mul(taxRate);
    const roundedTax = roundHalfToEven(calculatedTax);
    const netToStaff = info.total.sub(roundedTax);
    rows.push({
      staffId,
      staffName: info.staffName,
      staffRole: info.staffRole,
      total: info.total,
      taxRate,
      calculatedTax,
      roundedTax,
      netToStaff,
    });
  }

  return rows.sort((a, b) => a.staffName.localeCompare(b.staffName));
}
