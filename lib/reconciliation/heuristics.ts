import Decimal from "decimal.js";
import type { AccountType } from "@prisma/client";

export interface Suggestion {
  title: string;
  body: string;
  txIds: string[];
  kind: "equal_opposite" | "outlier" | "decimal_typo" | "orphan";
}

export interface AccountVariance {
  account: AccountType;
  variance: Decimal;
}

interface TxLite {
  id: string;
  amount: Decimal;
  type: string;
  playerId: string | null;
  ledgerEntries: Array<{ account: AccountType; delta: Decimal }>;
}

export function findEqualOpposite(variances: AccountVariance[], txs: TxLite[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  for (let i = 0; i < variances.length; i++) {
    for (let j = i + 1; j < variances.length; j++) {
      const a = variances[i];
      const b = variances[j];
      if (a.variance.equals(0) || b.variance.equals(0)) continue;
      if (!a.variance.add(b.variance).equals(0)) continue;
      const magnitude = a.variance.abs();
      const candidates = txs.filter((tx) => tx.amount.equals(magnitude));
      if (candidates.length === 0) continue;
      suggestions.push({
        kind: "equal_opposite",
        title: `Possible method mistype: ${a.account} and ${b.account} variances cancel out`,
        body: `${a.account} is ${a.variance.toString()}, ${b.account} is ${b.variance.toString()}. Transactions of $${magnitude} may have been recorded with the wrong method.`,
        txIds: candidates.map((c) => c.id),
      });
    }
  }
  return suggestions;
}

export function findOutliers(txs: TxLite[], multiplier = 5): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const byPlayer = new Map<string, TxLite[]>();
  for (const tx of txs) {
    if (!tx.playerId) continue;
    const arr = byPlayer.get(tx.playerId) ?? [];
    arr.push(tx);
    byPlayer.set(tx.playerId, arr);
  }
  for (const playerTxs of byPlayer.values()) {
    if (playerTxs.length < 3) continue;
    const sorted = [...playerTxs].sort((a, b) => Number(a.amount.minus(b.amount).toString()));
    const median = sorted[Math.floor(sorted.length / 2)].amount;
    if (median.equals(0)) continue;
    for (const tx of playerTxs) {
      if (tx.amount.greaterThan(median.mul(multiplier))) {
        suggestions.push({
          kind: "outlier",
          title: `Outlier amount: $${tx.amount.toString()}`,
          body: `Player's median transaction is $${median.toString()}; this is ${tx.amount.div(median).toFixed(1)}×.`,
          txIds: [tx.id],
        });
      }
    }
  }
  return suggestions;
}

export function findDecimalTypos(txs: TxLite[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const byPlayer = new Map<string, TxLite[]>();
  for (const tx of txs) {
    if (!tx.playerId) continue;
    const arr = byPlayer.get(tx.playerId) ?? [];
    arr.push(tx);
    byPlayer.set(tx.playerId, arr);
  }
  for (const playerTxs of byPlayer.values()) {
    for (const a of playerTxs) {
      for (const b of playerTxs) {
        if (a.id === b.id) continue;
        if (a.amount.equals(b.amount.mul(10))) {
          suggestions.push({
            kind: "decimal_typo",
            title: `Possible decimal typo: $${a.amount.toString()} is 10× $${b.amount.toString()}`,
            body: `Same player has a transaction at exactly 10× another. May be an extra zero.`,
            txIds: [a.id, b.id],
          });
        }
      }
    }
  }
  return suggestions;
}

export function findOrphans(allTxs: TxLite[]): Suggestion[] {
  const buyInPlayers = new Set<string>();
  const cashOutPlayers = new Set<string>();
  const markerPlayers = new Set<string>();
  const walkPlayers = new Set<string>();

  for (const tx of allTxs) {
    if (!tx.playerId) continue;
    if (tx.type === "BUY_IN") buyInPlayers.add(tx.playerId);
    if (tx.type === "CASH_OUT") cashOutPlayers.add(tx.playerId);
    if (tx.type === "MARKER_ISSUE") markerPlayers.add(tx.playerId);
    if (tx.type === "CHIP_WALK") walkPlayers.add(tx.playerId);
  }

  const orphans: string[] = [];
  for (const p of buyInPlayers) {
    if (!cashOutPlayers.has(p) && !markerPlayers.has(p) && !walkPlayers.has(p)) {
      orphans.push(p);
    }
  }

  if (orphans.length === 0) return [];

  return [{
    kind: "orphan",
    title: `${orphans.length} orphaned buy-in${orphans.length === 1 ? "" : "s"}`,
    body: "Players bought in but never cashed out, no marker, no walk recorded. They may have busted (no action needed) or walked with chips (record a chip_walk).",
    txIds: [],
  }];
}

export function runAllHeuristics(variances: AccountVariance[], txs: TxLite[]): Suggestion[] {
  return [
    ...findEqualOpposite(variances, txs),
    ...findOutliers(txs),
    ...findDecimalTypos(txs),
    ...findOrphans(txs),
  ];
}
