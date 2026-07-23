-- Migration: Add target_user_id and target_product_id to vouchers table
-- Untuk mendukung voucher hasil nego yang terbatas untuk user & produk tertentu

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS target_user_id VARCHAR NULL,
  ADD COLUMN IF NOT EXISTS target_product_id VARCHAR NULL;

-- Index untuk mempercepat filter berdasarkan target
CREATE INDEX IF NOT EXISTS idx_vouchers_target_user_id ON vouchers(target_user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_target_product_id ON vouchers(target_product_id);