import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";
import { MarkerModalClient } from "./tx-marker-modal-client";

interface MarkerModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function MarkerModal({ sessionId, gameId, trigger }: MarkerModalProps) {
  const clubId = await getActiveClubId();
  const players = await prisma.player.findMany({
    where: { clubId },
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true },
  });
  const openMarkers = await prisma.marker.findMany({
    where: { status: "OPEN", clubId },
    include: { player: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const openMarkersClient = openMarkers.map((m) => ({
    id: m.id,
    playerId: m.playerId,
    playerName: m.player.displayName,
    amount: m.amount.toString(),
    repaidAmount: m.repaidAmount.toString(),
  }));
  return (
    <MarkerModalClient
      sessionId={sessionId}
      gameId={gameId}
      players={players}
      openMarkers={openMarkersClient}
      trigger={trigger}
    />
  );
}
