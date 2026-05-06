import { prisma } from "@/lib/db";
import { CashOutModalClient } from "./tx-cashout-modal-client";

interface CashOutModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function CashOutModal({ sessionId, gameId, trigger }: CashOutModalProps) {
  const players = await prisma.player.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });
  return (
    <CashOutModalClient
      sessionId={sessionId}
      gameId={gameId}
      players={players}
      trigger={trigger}
    />
  );
}
