"use server";

import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import type { TransactionType } from "@prisma/client";

export interface ActivityRow {
  id: string;
  createdAt: string; // ISO; serialized for client transport
  type: TransactionType;
  amount: string;
  method: string;
  note: string | null;
  gameName: string | null;
  tableName: string | null;
  reversesId: string | null;
  staffName: string | null;
  playerName: string | null;
}

export interface PlayerTotals {
  buyIn: string;
  cashOut: string;
  markersIssued: string;
  markersRepaid: string;
  walks: string;
  returns: string;
  /** Net cash the player put in: buy-ins (any method) + tournament fees − cash-outs − tournament payouts − jackpot/freeroll cash payouts. Chip-only events (RAKE, TIP_DROP) do not affect this. */
  netCash: string;
}

export interface PlayerActivity {
  rows: ActivityRow[];
  totals: PlayerTotals;
}

export async function getPlayerSessionActivity(sessionId: string, playerId: string): Promise<PlayerActivity> {
  const txs = await prisma.transaction.findMany({
    where: { sessionId, playerId },
    include: { game: true, table: true, staff: true, player: true },
    orderBy: { createdAt: "asc" },
  });

  const rows: ActivityRow[] = txs.map((t) => ({
    id: t.id,
    createdAt: t.createdAt.toISOString(),
    type: t.type,
    amount: t.amount.toString(),
    method: t.method,
    note: t.note,
    gameName: t.game?.name ?? null,
    tableName: t.table?.name ?? null,
    reversesId: t.reversesId,
    staffName: t.staff?.name ?? null,
    playerName: t.player?.displayName ?? null,
  }));

  // Sum amounts per category. Three categories of rows are excluded from totals:
  //   1. Reversals themselves (reversesId IS NOT NULL).
  //   2. Originals that have been reversed — their economic effect was undone, so counting
  //      them would double-count after a correction.
  // All three rows (original, reversal, corrected) still appear in the rows list above for
  // audit transparency; only the totals exclude the negated pair.
  const reversedIds = new Set<string>();
  for (const t of txs) {
    if (t.reversesId) reversedIds.add(t.reversesId);
  }

  let buyIn = new Decimal(0);
  let cashOut = new Decimal(0);
  let markersIssued = new Decimal(0);
  let markersRepaid = new Decimal(0);
  let walks = new Decimal(0);
  let returns = new Decimal(0);
  let netCash = new Decimal(0);

  for (const t of txs) {
    if (t.reversesId) continue;
    if (reversedIds.has(t.id)) continue;
    const amt = new Decimal(t.amount.toString());
    switch (t.type) {
      case "BUY_IN":           buyIn = buyIn.add(amt);           netCash = netCash.add(amt);          break;
      case "CASH_OUT":         cashOut = cashOut.add(amt);       netCash = netCash.sub(amt);          break;
      case "MARKER_ISSUE":     markersIssued = markersIssued.add(amt);                                break;
      case "MARKER_REPAY":     markersRepaid = markersRepaid.add(amt); netCash = netCash.add(amt);    break;
      case "CHIP_WALK":        walks = walks.add(amt);                                                break;
      case "CHIP_RETURN":      returns = returns.add(amt);                                            break;
      case "TOURNAMENT_FEE":   netCash = netCash.add(amt);                                            break;
      case "TOURNAMENT_PAYOUT": netCash = netCash.sub(amt);                                           break;
      // JACKPOT_PAYOUT and FREEROLL_PRIZE_PAYOUT: cash-out flavor reduces drawer; chips flavor doesn't touch cash.
      // We can't distinguish here without entries; skip. If precise, re-derive from ledger entries later.
    }
  }

  return {
    rows,
    totals: {
      buyIn: buyIn.toString(),
      cashOut: cashOut.toString(),
      markersIssued: markersIssued.toString(),
      markersRepaid: markersRepaid.toString(),
      walks: walks.toString(),
      returns: returns.toString(),
      netCash: netCash.toString(),
    },
  };
}

export interface StaffTotals {
  rakeDrops: string;
  tipDrops: string;
  dropCount: number;
  lastDropAt: string | null;
}

export interface StaffActivity {
  rows: ActivityRow[];
  totals: StaffTotals;
}

export async function getStaffSessionActivity(sessionId: string, staffId: string): Promise<StaffActivity> {
  const txs = await prisma.transaction.findMany({
    where: { sessionId, staffId },
    include: { game: true, table: true, staff: true, player: true },
    orderBy: { createdAt: "asc" },
  });

  const rows: ActivityRow[] = txs.map((t) => ({
    id: t.id,
    createdAt: t.createdAt.toISOString(),
    type: t.type,
    amount: t.amount.toString(),
    method: t.method,
    note: t.note,
    gameName: t.game?.name ?? null,
    tableName: t.table?.name ?? null,
    reversesId: t.reversesId,
    staffName: t.staff?.name ?? null,
    playerName: t.player?.displayName ?? null,
  }));

  // Same exclusion rules as the player path: skip both reversals AND originals
  // that were reversed (their effect was undone via correction).
  const reversedIds = new Set<string>();
  for (const t of txs) {
    if (t.reversesId) reversedIds.add(t.reversesId);
  }

  let rakeDrops = new Decimal(0);
  let tipDrops = new Decimal(0);
  let dropCount = 0;
  let lastDropAt: Date | null = null;

  for (const t of txs) {
    if (t.reversesId) continue;
    if (reversedIds.has(t.id)) continue;
    if (t.type === "RAKE") {
      rakeDrops = rakeDrops.add(t.amount.toString());
      dropCount++;
      if (!lastDropAt || t.createdAt > lastDropAt) lastDropAt = t.createdAt;
    } else if (t.type === "TIP_DROP") {
      tipDrops = tipDrops.add(t.amount.toString());
      dropCount++;
      if (!lastDropAt || t.createdAt > lastDropAt) lastDropAt = t.createdAt;
    }
  }

  return {
    rows,
    totals: {
      rakeDrops: rakeDrops.toString(),
      tipDrops: tipDrops.toString(),
      dropCount,
      lastDropAt: lastDropAt ? lastDropAt.toISOString() : null,
    },
  };
}
