-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "readings" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "temperature" DOUBLE PRECISION,
    "solar_voltage" DOUBLE PRECISION,
    "solar_current" DOUBLE PRECISION,
    "solar_power" DOUBLE PRECISION,
    "battery_voltage" DOUBLE PRECISION,
    "battery_current" DOUBLE PRECISION,
    "battery_power" DOUBLE PRECISION,
    "battery_percentage" DOUBLE PRECISION,
    "pump_status" TEXT NOT NULL DEFAULT 'off',
    "pump_last_run" TIMESTAMPTZ(3),
    "pump_next_scheduled_run" TIMESTAMPTZ(3),
    "location_name" TEXT NOT NULL DEFAULT 'My Garden',
    "location_lat" DOUBLE PRECISION,
    "location_lon" DOUBLE PRECISION,

    CONSTRAINT "readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" SERIAL NOT NULL,
    "time" TEXT NOT NULL,
    "days" INTEGER[],
    "duration_seconds" INTEGER NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pump_commands" (
    "id" SERIAL NOT NULL,
    "command" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pump_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" SERIAL NOT NULL,
    "insight" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "readings_timestamp_idx" ON "readings"("timestamp");

-- CreateIndex
CREATE INDEX "pump_commands_acknowledged_id_idx" ON "pump_commands"("acknowledged", "id");

-- CreateIndex
CREATE INDEX "ai_insights_created_at_idx" ON "ai_insights"("created_at");

