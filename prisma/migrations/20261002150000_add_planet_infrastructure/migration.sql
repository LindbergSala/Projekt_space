-- Existing planets receive the canonical implicit baseline: Command 1, others 0.
-- No previous planet values or history rows are rewritten.
ALTER TABLE "planet"
ADD COLUMN "materialsProductionRemainder" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "infrastructureEpoch" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "planet_materialsProductionRemainder_valid"
CHECK ("materialsProductionRemainder" >= 0 AND "materialsProductionRemainder" < 3600000);

CREATE TABLE "planet_construction" (
    "id" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "buildingKey" VARCHAR(32) NOT NULL,
    "fromLevel" INTEGER NOT NULL,
    "targetLevel" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "materialsCost" BIGINT NOT NULL,
    CONSTRAINT "planet_construction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "planet_construction_building_valid" CHECK (
      "buildingKey" IN ('planetary-command', 'materials-extractor', 'barracks', 'war-factory', 'space-station')
    ),
    CONSTRAINT "planet_construction_level_valid" CHECK (
      "targetLevel" BETWEEN 1 AND 5 AND "fromLevel" = "targetLevel" - 1
      AND ("buildingKey" <> 'planetary-command' OR "targetLevel" >= 2)
    ),
    CONSTRAINT "planet_construction_cost_positive" CHECK ("materialsCost" > 0),
    CONSTRAINT "planet_construction_time_valid" CHECK ("completesAt" > "startedAt")
);

CREATE UNIQUE INDEX "planet_construction_level_key"
ON "planet_construction"("planetId", "buildingKey", "targetLevel");
CREATE INDEX "planet_construction_completion_idx"
ON "planet_construction"("planetId", "completesAt");
ALTER TABLE "planet_construction" ADD CONSTRAINT "planet_construction_planetId_fkey"
FOREIGN KEY ("planetId") REFERENCES "planet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
