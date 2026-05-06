import { prisma } from "@/lib/db";
import { JackpotModalClient } from "./tx-jackpot-modal-client";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function JackpotModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });
  return (
    <JackpotModalClient
      sessionId={sessionId}
      gameId={gameId}
      players={players}
      trigger={trigger}
    />
  );
}
