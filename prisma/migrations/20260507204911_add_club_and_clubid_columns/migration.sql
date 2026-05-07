-- CreateEnum
CREATE TYPE "ClubMembershipRole" AS ENUM ('OWNER', 'ADMIN', 'CASHIER', 'RUNNER');

-- CreateEnum
CREATE TYPE "ClubMembershipStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "Marker" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "SystemSettings" DROP CONSTRAINT "SystemSettings_pkey",
ADD COLUMN     "clubId" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "clubId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clubId" TEXT;

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "role" "ClubMembershipRole" NOT NULL,
    "status" "ClubMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");

-- CreateIndex
CREATE INDEX "Club_slug_idx" ON "Club"("slug");

-- CreateIndex
CREATE INDEX "ClubMembership_clubId_status_idx" ON "ClubMembership"("clubId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClubMembership_userId_clubId_key" ON "ClubMembership"("userId", "clubId");

-- CreateIndex
CREATE INDEX "Game_clubId_idx" ON "Game"("clubId");

-- CreateIndex
CREATE INDEX "Marker_clubId_idx" ON "Marker"("clubId");

-- CreateIndex
CREATE INDEX "Player_clubId_idx" ON "Player"("clubId");

-- CreateIndex
CREATE INDEX "Session_clubId_idx" ON "Session"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSettings_clubId_key" ON "SystemSettings"("clubId");

-- CreateIndex
CREATE INDEX "Table_clubId_idx" ON "Table"("clubId");

-- CreateIndex
CREATE INDEX "Transaction_clubId_idx" ON "Transaction"("clubId");

-- CreateIndex
CREATE INDEX "User_clubId_idx" ON "User"("clubId");

-- AddForeignKey
ALTER TABLE "ClubMembership" ADD CONSTRAINT "ClubMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMembership" ADD CONSTRAINT "ClubMembership_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Marker" ADD CONSTRAINT "Marker_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSettings" ADD CONSTRAINT "SystemSettings_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

