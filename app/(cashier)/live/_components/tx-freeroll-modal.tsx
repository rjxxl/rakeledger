import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";
import { FreerollModalClient } from "./tx-freeroll-modal-client";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function FreerollModal({ sessionId, gameId, trigger }: Props) {
  const clubId = await getActiveClubId();
  const players = await prisma.player.findMany({
    where: { clubId },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });
  return (
    <FreerollModalClient
      sessionId={sessionId}
      gameId={gameId}
      players={players}
      trigger={trigger}
    />
  );
}
