-- =============================================================================
-- Migration: add-order-payment-shipping-fields
-- Deskripsi: Menambahkan kolom-kolom baru pada tabel orders untuk mendukung
--            fitur payment gateway (Midtrans) dan shipping (Biteship).
-- Dibuat: 2026-07-04
-- =============================================================================

-- -------------------------------------------------------
-- 1. shipping_type: Tipe pengiriman ('regular' atau 'instant')
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_type VARCHAR(20) NOT NULL DEFAULT 'regular';

-- -------------------------------------------------------
-- 2. is_locked: Order dikunci setelah diproses admin
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- -------------------------------------------------------
-- 3. payment_method: Metode pembayaran dari Midtrans
--    (qris, bank_transfer, credit_card, dll)
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(255) NULL;

-- -------------------------------------------------------
-- 4. address_id: ID alamat pengiriman yang dipilih user
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_id VARCHAR(255) NULL;

-- -------------------------------------------------------
-- 5. awb_number: Nomor AWB/Resi dari Biteship
--    (berbeda dengan tracking_number yang bisa diisi manual)
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_number VARCHAR(255) NULL;

-- -------------------------------------------------------
-- 6. awb_url: URL cetak label AWB dari Biteship
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_url TEXT NULL;

-- -------------------------------------------------------
-- 7. biteship_order_id: ID Order dari Biteship
--    Digunakan untuk request pickup via API Biteship
--    (bukan AWB — ini adalah ID internal Biteship untuk order)
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS biteship_order_id VARCHAR(255) NULL;

-- -------------------------------------------------------
-- 8. pickup_request_id: ID request pickup dari Biteship
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_request_id VARCHAR(255) NULL;

-- -------------------------------------------------------
-- 9. delivered_at: Waktu kurir menandai paket terkirim
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL;

-- -------------------------------------------------------
-- 10. completed_at: Waktu pesanan selesai
--     (konfirmasi buyer atau auto-complete setelah 2 hari)
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

-- -------------------------------------------------------
-- 11. shipping_details: Detail pengiriman tambahan
--     (rate, estimasi durasi, nama kurir lengkap, dll)
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_details JSON NULL;

-- -------------------------------------------------------
-- 12. shipping_address_snapshot: Snapshot alamat saat checkout
--     Menyimpan nama, telepon, alamat, kode pos, dll
--     Penting agar data alamat tidak berubah jika user
--     mengedit alamat setelah order dibuat
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_snapshot JSONB NULL;

-- -------------------------------------------------------
-- 13. payment_token: Token Midtrans untuk snap payment
-- -------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_token VARCHAR(255) NULL;

-- =============================================================================
-- ROLLBACK (jalankan manual jika perlu undo):
-- =============================================================================
-- ALTER TABLE orders DROP COLUMN IF EXISTS shipping_type;
-- ALTER TABLE orders DROP COLUMN IF EXISTS is_locked;
-- ALTER TABLE orders DROP COLUMN IF EXISTS payment_method;
-- ALTER TABLE orders DROP COLUMN IF EXISTS address_id;
-- ALTER TABLE orders DROP COLUMN IF EXISTS awb_number;
-- ALTER TABLE orders DROP COLUMN IF EXISTS awb_url;
-- ALTER TABLE orders DROP COLUMN IF EXISTS biteship_order_id;
-- ALTER TABLE orders DROP COLUMN IF EXISTS pickup_request_id;
-- ALTER TABLE orders DROP COLUMN IF EXISTS delivered_at;
-- ALTER TABLE orders DROP COLUMN IF EXISTS completed_at;
-- ALTER TABLE orders DROP COLUMN IF EXISTS shipping_details;
-- ALTER TABLE orders DROP COLUMN IF EXISTS shipping_address_snapshot;
-- ALTER TABLE orders DROP COLUMN IF EXISTS payment_token;
