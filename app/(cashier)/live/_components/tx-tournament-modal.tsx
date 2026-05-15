import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";
import { TournamentModalClient } from "./tx-tournament-modal-client";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function TournamentModal({ sessionId, gameId, trigger }: Props) {
  const clubId = await getActiveClubId();
  const players = await prisma.player.findMany({
    where: { clubId },
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
