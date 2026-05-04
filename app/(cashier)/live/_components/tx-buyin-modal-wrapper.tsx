import { prisma } from "@/lib/db";
import { getUnredeemedPromoForPlayer } from "../../_actions/transactions";
import { BuyInModal } from "./tx-buyin-modal";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function BuyInModalServer({ sessionId, gameId, trigger }: Props) {
  const [players, tables] = await Promise.all([
    prisma.player.findMany({ orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    prisma.table.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  async function getUnredeemedPromo(playerId: string) {
    "use server";
    return getUnredeemedPromoForPlayer(sessionId, playerId);
  }

  return (
    <BuyInModal
      sessionId={sessionId}
      gameId={gameId}
      players={players}
      tables={tables}
      getUnredeemedPromo={getUnredeemedPromo}
      trigger={trigger}
    />
  );
}
