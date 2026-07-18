-- Migration: Add Tax Invoice fields to orders table and create invoices table
-- This migration adds:
-- 1. is_tax_invoice_requested and tax_invoice_request columns to orders
-- 2. invoices table for storing generated invoices

-- ============================================================================
-- 1. Update orders table: Add tax invoice request columns
-- ============================================================================
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS is_tax_invoice_requested BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_invoice_request JSONB NULL;

-- ============================================================================
-- 2. Create invoices table
-- ============================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  invoice_type VARCHAR(20) DEFAULT 'PROFORMA',
  customer_name VARCHAR(255),
  customer_address TEXT,
  customer_npwp VARCHAR(20),
  company_name VARCHAR(255),
  company_address TEXT,
  company_email VARCHAR(255),
  npwp_document_url TEXT,
  items JSONB,
  subtotal DECIMAL(12,2) DEFAULT 0,
  shipping_cost DECIMAL(10,2) DEFAULT 0,
  discount DECIMAL(10,2) DEFAULT 0,
  ppn DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(12,2) DEFAULT 0,
  payment_method VARCHAR(50),
  status VARCHAR(20) DEFAULT 'ISSUED',
  notes TEXT,
  generated_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
