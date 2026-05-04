import { BuyInModalServer } from "./tx-buyin-modal-wrapper";
import { CashOutModal } from "./tx-cashout-modal";
import { RakeModal } from "./tx-rake-modal";
import { TipDropModal } from "./tx-tipdrop-modal";
import { MarkerModal } from "./tx-marker-modal";
import { TournamentModal } from "./tx-tournament-modal";
import { JackpotModal } from "./tx-jackpot-modal";
import { FreerollModal } from "./tx-freeroll-modal";
import { MiscModal } from "./tx-misc-modal";

interface QuickActionsProps {
  sessionId: string;
  gameId: string;
}

const baseBtn =
  "bg-[var(--color-bg)] border border-[var(--color-border)] text-slate-200 font-semibold rounded-lg p-3 text-sm hover:border-amber-500 hover:text-amber-500 transition cursor-pointer w-full";

export async function QuickActions({ sessionId, gameId }: QuickActionsProps) {
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-3">Quick actions</h4>
      <div className="grid grid-cols-2 gap-2">
        <BuyInModalServer sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Buy-in</button>} />
        <CashOutModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>− Cash-out</button>} />
        <RakeModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Rake</button>} />
        <TipDropModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Tip drop</button>} />
        <MarkerModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>$ Marker</button>} />
        <TournamentModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>⇄ Tournament</button>} />
        <JackpotModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>🏆 Jackpot</button>} />
        <FreerollModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>🎁 Freeroll</button>} />
        <MiscModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn} style={{ gridColumn: "span 2" }}>⋯ Other</button>} />
      </div>
    </div>
  );
}
