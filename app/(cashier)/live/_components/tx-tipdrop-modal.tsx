import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";
import { TipDropModalClient } from "./tx-tipdrop-modal-client";

interface TipDropModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function TipDropModal({ sessionId, gameId, trigger }: TipDropModalProps) {
  const clubId = await getActiveClubId();
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS"] }, status: "ACTIVE", clubId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  return (
    <TipDropModalClient
      sessionId={sessionId}
      gameId={gameId}
      staff={staff}
      trigger={trigger}
    />
  );
}
