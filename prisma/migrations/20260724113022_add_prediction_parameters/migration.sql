-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Matter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "substantiveLaw" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "status" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    "estimatedValue" DECIMAL,
    "exposureAmount" DECIMAL,
    "liabilityEstimate" TEXT,
    "jurisdictionTier" TEXT,
    "estimatedResolution" DATETIME,
    "insurerInvolved" BOOLEAN NOT NULL DEFAULT false,
    "budgetApprovalRoute" TEXT
);
INSERT INTO "new_Matter" ("category", "closedAt", "description", "estimatedValue", "id", "jurisdiction", "name", "openedAt", "status", "substantiveLaw") SELECT "category", "closedAt", "description", "estimatedValue", "id", "jurisdiction", "name", "openedAt", "status", "substantiveLaw" FROM "Matter";
DROP TABLE "Matter";
ALTER TABLE "new_Matter" RENAME TO "Matter";
CREATE INDEX "Matter_substantiveLaw_idx" ON "Matter"("substantiveLaw");
CREATE INDEX "Matter_category_idx" ON "Matter"("category");
CREATE INDEX "Matter_status_idx" ON "Matter"("status");
CREATE INDEX "Matter_category_liabilityEstimate_idx" ON "Matter"("category", "liabilityEstimate");
CREATE INDEX "Matter_category_jurisdictionTier_idx" ON "Matter"("category", "jurisdictionTier");
CREATE INDEX "Matter_substantiveLaw_category_liabilityEstimate_jurisdictionTier_idx" ON "Matter"("substantiveLaw", "category", "liabilityEstimate", "jurisdictionTier");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
