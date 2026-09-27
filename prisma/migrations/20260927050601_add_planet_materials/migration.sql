-- AlterTable
ALTER TABLE "planet" ADD COLUMN     "materials" BIGINT NOT NULL DEFAULT 0;

-- AddCheckConstraint
ALTER TABLE "planet" ADD CONSTRAINT "planet_materials_nonnegative" CHECK ("materials" >= 0);
