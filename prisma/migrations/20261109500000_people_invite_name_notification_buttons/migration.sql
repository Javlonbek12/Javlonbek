-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "forName" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "buttons" JSONB;
