/**
 * Shipment Status — tracks the lifecycle of a physical shipment.
 * Separate from FulfillmentStatus (which tracks admin workflow).
 */
export enum ShipmentStatus {
  PENDING = 'PENDING',
  BOOKED = 'BOOKED',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export const SHIPMENT_STATUSES = Object.values(ShipmentStatus);