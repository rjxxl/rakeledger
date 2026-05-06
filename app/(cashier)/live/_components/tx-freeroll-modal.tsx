import { prisma } from "@/lib/db";
import { FreerollModalClient } from "./tx-freeroll-modal-client";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function FreerollModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({
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
