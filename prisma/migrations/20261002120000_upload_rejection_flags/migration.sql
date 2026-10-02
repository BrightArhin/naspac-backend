ALTER TABLE "Submission" ADD COLUMN "uploadRejected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Submission" ADD COLUMN "uploadRejectionReason" TEXT;
ALTER TABLE "Submission" ADD COLUMN "verificationRejected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Submission" ADD COLUMN "verificationRejectionReason" TEXT;
