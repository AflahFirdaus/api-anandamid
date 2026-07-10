-- Migration: Add fulfillment fields to orders table
-- Run this against your database

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(30) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS shipping_method VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS handover_method VARCHAR(20) NULL;

-- Add index for fulfillment_status for faster queries
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders(fulfillment_status);

-- Add index for shipping_method
CREATE INDEX IF NOT EXISTS idx_orders_shipping_method ON orders(shipping_method);

-- Update existing orders: set shipping_method based on shipping_type
UPDATE orders SET shipping_method = 
  CASE 
    WHEN shipping_type = 'instant' THEN 'INSTANT'
    ELSE 'REGULAR'
  END
WHERE shipping_method IS NULL;

-- Update existing LUNAS/DIKEMAS orders to have appropriate fulfillment status
UPDATE orders SET fulfillment_status = 'PACKING' 
WHERE status IN ('DIKEMAS') AND fulfillment_status = 'NONE';

UPDATE orders SET fulfillment_status = 'LABEL_READY'
WHERE status IN ('DIKIRIM') AND fulfillment_status = 'NONE';

UPDATE orders SET fulfillment_status = 'DELIVERED'
WHERE status IN ('SELESAI') AND fulfillment_status = 'NONE';