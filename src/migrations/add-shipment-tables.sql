-- Migration: Add shipment tables for the new Shipment module
-- Run this after add-fulfillment-fields.sql

-- ====================== SHIPMENTS TABLE ======================
CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  
  -- Courier
  courier_name VARCHAR(50),
  courier_service VARCHAR(50),
  shipping_method VARCHAR(20),
  handover_method VARCHAR(20),
  
  -- AWB
  awb_number VARCHAR(255),
  awb_url TEXT,
  biteship_order_id VARCHAR(255),
  
  -- Tracking
  tracking_url TEXT,
  pickup_request_id VARCHAR(255),
  
  -- Driver (Instant)
  driver_info JSONB,
  
  -- Status
  shipment_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  label_status VARCHAR(20) NOT NULL DEFAULT 'NOT_READY',
  label_print_count INT NOT NULL DEFAULT 0,
  last_label_printed_at TIMESTAMPTZ,
  printed_by VARCHAR(50),
  printed_at TIMESTAMPTZ,
  
  -- Snapshot (immutable)
  shipping_snapshot JSONB,
  
  -- Timestamps
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_shipment_status ON shipments(shipment_status);
CREATE INDEX IF NOT EXISTS idx_shipments_awb_number ON shipments(awb_number);

-- ====================== SHIPMENT TRACKING TABLE ======================
CREATE TABLE IF NOT EXISTS shipment_trackings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event VARCHAR(50) NOT NULL,
  description TEXT,
  location TEXT,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipment_trackings_shipment_id ON shipment_trackings(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_trackings_event ON shipment_trackings(event);

-- ====================== COURIER CAPABILITIES TABLE ======================
CREATE TABLE IF NOT EXISTS courier_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_code VARCHAR(50) NOT NULL UNIQUE,
  courier_name VARCHAR(100) NOT NULL,
  supports_pickup BOOLEAN NOT NULL DEFAULT TRUE,
  supports_drop_off BOOLEAN NOT NULL DEFAULT TRUE,
  supports_instant BOOLEAN NOT NULL DEFAULT TRUE,
  supports_same_day BOOLEAN NOT NULL DEFAULT TRUE,
  supports_regular BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default courier capabilities
INSERT INTO courier_capabilities (courier_code, courier_name, supports_pickup, supports_drop_off, supports_instant, supports_same_day, supports_regular)
VALUES 
  ('jne', 'JNE', TRUE, TRUE, FALSE, FALSE, TRUE),
  ('jnt', 'J&T Express', TRUE, TRUE, FALSE, FALSE, TRUE),
  ('sicepat', 'SiCepat', TRUE, TRUE, FALSE, TRUE, TRUE),
  ('tiki', 'TIKI', TRUE, TRUE, FALSE, FALSE, TRUE),
  ('pos', 'POS Indonesia', FALSE, TRUE, FALSE, FALSE, TRUE),
  ('anteraja', 'AnterAja', TRUE, TRUE, FALSE, TRUE, TRUE),
  ('ninjaxpress', 'Ninja Xpress', TRUE, TRUE, FALSE, FALSE, TRUE),
  ('wahana', 'Wahana', TRUE, TRUE, FALSE, FALSE, TRUE),
  ('gojek', 'GoSend', TRUE, FALSE, TRUE, TRUE, FALSE),
  ('grab', 'GrabExpress', TRUE, FALSE, TRUE, TRUE, FALSE)
ON CONFLICT (courier_code) DO NOTHING;