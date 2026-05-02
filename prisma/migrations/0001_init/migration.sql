-- ============================================================================
-- Migration: 0001_init — city-weather-search initial schema
-- ============================================================================
--
-- Scope: this app is anonymous and stateless. The ONLY persisted entity is
-- `upstream_error_log`. There are deliberately NO `user`, `session`,
-- `search_history`, or similar tables, and downstream agents (backend_agent,
-- etc.) MUST NOT add them — the spec mandates no persistence beyond the
-- upstream-failure error log.
--
-- The error log backs the "logs the error server-side" requirement of the
-- geocoder-unavailable and weather-unavailable scenarios. There is no read
-- endpoint in scope; operators inspect this table directly via psql.
--
-- Application-level rule: `upstream_message` MUST be truncated to 1 KB by
-- the DB access module (insertUpstreamError) before insert. The column
-- itself is unbounded TEXT for safety.
-- ============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UpstreamSource" AS ENUM ('GEOCODER', 'WEATHER');

-- CreateTable
CREATE TABLE "upstream_error_log" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "UpstreamSource" NOT NULL,
    "upstream_status" INTEGER,
    "upstream_message" TEXT,
    "request_city" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upstream_error_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upstream_error_log_occurred_at_idx" ON "upstream_error_log"("occurred_at");

-- CreateIndex
CREATE INDEX "upstream_error_log_source_occurred_at_idx" ON "upstream_error_log"("source", "occurred_at");
