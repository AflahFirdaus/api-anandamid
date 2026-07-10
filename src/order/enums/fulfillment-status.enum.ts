/**
 * Internal Fulfillment Status — NOT shown in UI.
 * Controls business logic for the fulfillment pipeline.
 * UI still uses OrderStatus for display.
 */
export enum FulfillmentStatus {
  NONE = 'NONE',
  PACKING = 'PACKING',
  READY_TO_SHIP = 'READY_TO_SHIP',
  SHIPPING_SETUP = 'SHIPPING_SETUP',
  DRIVER_SEARCHING = 'DRIVER_SEARCHING',
  DRIVER_FOUND = 'DRIVER_FOUND',
  BOOKING_PICKUP = 'BOOKING_PICKUP',
  BOOKING_SUCCESS = 'BOOKING_SUCCESS',
  AWB_GENERATED = 'AWB_GENERATED',
  LABEL_READY = 'LABEL_READY',
  LABEL_PRINTED = 'LABEL_PRINTED',
  WAITING_PICKUP = 'WAITING_PICKUP',
  PICKED_UP = 'PICKED_UP',
  SHIPPING = 'SHIPPING',
  DELIVERED = 'DELIVERED',
}

/**
 * All valid fulfillment statuses as an array for validation.
 */
export const FULFILLMENT_STATUSES = Object.values(FulfillmentStatus);

/**
 * Human-readable labels for fulfillment statuses (for internal logging only).
 */
export const FULFILLMENT_STATUS_LABELS: Record<string, string> = {
  NONE: 'Belum Diproses',
  PACKING: 'Packing',
  READY_TO_SHIP: 'Siap Kirim',
  SHIPPING_SETUP: 'Atur Pengiriman',
  DRIVER_SEARCHING: 'Cari Driver',
  DRIVER_FOUND: 'Driver Ditemukan',
  BOOKING_PICKUP: 'Booking Pickup',
  BOOKING_SUCCESS: 'Booking Berhasil',
  AWB_GENERATED: 'AWB Generated',
  LABEL_READY: 'Label Siap',
  LABEL_PRINTED: 'Label Dicetak',
  WAITING_PICKUP: 'Menunggu Pickup',
  PICKED_UP: 'Sudah Diambil',
  SHIPPING: 'Dalam Pengiriman',
  DELIVERED: 'Terkirim',
};