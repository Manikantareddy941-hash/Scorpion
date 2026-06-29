-- CreateTable
CREATE TABLE "ScanResult" (
    "imageDigest" TEXT NOT NULL PRIMARY KEY,
    "reachabilityCounts" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
