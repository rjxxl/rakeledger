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
