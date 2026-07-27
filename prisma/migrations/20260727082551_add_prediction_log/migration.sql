-- CreateTable
CREATE TABLE "PredictionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matterId" TEXT NOT NULL,
    "predictionType" TEXT NOT NULL,
    "predictedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inputParameters" JSONB NOT NULL,
    "predictedValue" DECIMAL,
    "predictedP25" DECIMAL,
    "predictedP75" DECIMAL,
    "confidence" TEXT NOT NULL,
    "fallbackLevel" INTEGER,
    "sampleSize" INTEGER,
    "methodology" TEXT,
    "modelVersion" TEXT NOT NULL DEFAULT 'v2_0',
    "actualValue" DECIMAL,
    "actualClosedAt" DATETIME,
    "errorAbsolute" DECIMAL,
    "errorPercent" DECIMAL,
    "isWithinRange" BOOLEAN,
    CONSTRAINT "PredictionLog_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PredictionLog_matterId_idx" ON "PredictionLog"("matterId");

-- CreateIndex
CREATE INDEX "PredictionLog_predictionType_idx" ON "PredictionLog"("predictionType");

-- CreateIndex
CREATE INDEX "PredictionLog_predictedAt_idx" ON "PredictionLog"("predictedAt");

-- CreateIndex
CREATE INDEX "PredictionLog_modelVersion_idx" ON "PredictionLog"("modelVersion");
