import { prisma } from "@/lib/db";
import { TournamentModalClient } from "./tx-tournament-modal-client";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function TournamentModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });
  return (
    <TournamentModalClient
      sessionId={sessionId}
      gameId={gameId}
      players={players}
      trigger={trigger}
    />
  );
}
