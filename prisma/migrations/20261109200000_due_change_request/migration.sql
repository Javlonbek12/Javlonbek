-- The assignee asks to move the due date; the task's author decides.
ALTER TABLE "Task" ADD COLUMN "dueChangeById" TEXT,
ADD COLUMN "dueChangeAt" TIMESTAMP(3),
ADD COLUMN "dueChangeTo" DATE,
ADD COLUMN "dueChangeReason" TEXT;
