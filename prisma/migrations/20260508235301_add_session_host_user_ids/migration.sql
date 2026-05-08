-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "hostUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
