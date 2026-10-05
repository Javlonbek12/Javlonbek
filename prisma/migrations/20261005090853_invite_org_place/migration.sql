-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "orgNodeId" TEXT;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgNodeId_fkey" FOREIGN KEY ("orgNodeId") REFERENCES "OrgNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
