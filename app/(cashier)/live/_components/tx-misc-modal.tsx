import { prisma } from "@/lib/db";
import { MiscModalClient } from "./tx-misc-modal-client";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function MiscModal({ sessionId, gameId, trigger }: Props) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS", "RUNNER"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <MiscModalClient
      sessionId={sessionId}
      gameId={gameId}
      staff={staff}
      trigger={trigger}
    />
  );
}
