import { prisma } from "@/lib/db";
import { getActiveClubId } from "@/lib/active-user";
import { getTotalFreerollPrizesForPlayer } from "../../_actions/transactions";
import { BuyInModal } from "./tx-buyin-modal";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function BuyInModalServer({ sessionId, gameId, trigger }: Props) {
  const clubId = await getActiveClubId();
  const [players, tables] = await Promise.all([
    prisma.player.findMany({ where: { clubId }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    prisma.table.findMany({ where: { active: true, clubId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  async function getUnredeemedPromo(playerId: string) {
    "use server";
    return getTotalFreerollPrizesForPlayer(sessionId, playerId);
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
