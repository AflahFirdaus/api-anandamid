-- Migration: Add store pickup/delivery fields to orders table
-- Run this against your production database

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_estimate_minutes INT NULL,
  ADD COLUMN IF NOT EXISTS is_store_pickup BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_distance_km INT NULL,
  ADD COLUMN IF NOT EXISTS is_store_delivery BOOLEAN NOT NULL DEFAULT FALSE;