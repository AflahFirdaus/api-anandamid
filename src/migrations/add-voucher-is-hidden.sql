-- Migration: Add is_hidden column to vouchers table
-- Voucher yang sudah expired atau habis kuota akan otomatis di-hide
-- Admin tetap bisa melihatnya dengan filter "show hidden"

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

-- Index untuk filter hidden vouchers
CREATE INDEX IF NOT EXISTS idx_vouchers_is_hidden ON vouchers(is_hidden);