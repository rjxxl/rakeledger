import { prisma } from "@/lib/db";
import { RakeModalClient } from "./tx-rake-modal-client";

interface RakeModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function RakeModal({ sessionId, gameId, trigger }: RakeModalProps) {
  const dealers = await prisma.user.findMany({
    where: { role: "DEALER", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const tables = await prisma.table.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <RakeModalClient
      sessionId={sessionId}
      gameId={gameId}
      dealers={dealers}
      tables={tables}
      trigger={trigger}
    />
  );
}
