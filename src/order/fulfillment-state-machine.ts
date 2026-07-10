import { FulfillmentStatus } from './enums/fulfillment-status.enum';
import { ShippingMethod } from './enums/shipping-method.enum';

/**
 * Fulfillment State Machine - Validates all internal fulfillment transitions.
 * Completely separate from OrderStatus (which is for UI display).
 */
class FulfillmentTransition {
  constructor(
    public readonly from: FulfillmentStatus,
    public readonly to: FulfillmentStatus,
    public readonly shippingMethod?: ShippingMethod,
    public readonly handoverMethod?: 'PICKUP' | 'DROP_OFF',
  ) {}
}

// ── ALLOWED TRANSITIONS ──
// These are the valid fulfillment state transitions based on shipping method.

const INSTANT_TRANSITIONS: Map<FulfillmentStatus, FulfillmentStatus[]> = new Map([
  [FulfillmentStatus.NONE, [FulfillmentStatus.PACKING]],
  [FulfillmentStatus.PACKING, [FulfillmentStatus.DRIVER_SEARCHING, FulfillmentStatus.NONE]],  // NONE = cancel packing
    [
      FulfillmentStatus.DRIVER_SEARCHING,
      [FulfillmentStatus.DRIVER_FOUND, FulfillmentStatus.PACKING],
    ], // driver not found, back to packing
  [FulfillmentStatus.DRIVER_FOUND, [FulfillmentStatus.BOOKING_SUCCESS, FulfillmentStatus.DRIVER_SEARCHING]],
  [FulfillmentStatus.BOOKING_SUCCESS, [FulfillmentStatus.AWB_GENERATED]],
  [FulfillmentStatus.AWB_GENERATED, [FulfillmentStatus.LABEL_READY]],
  [FulfillmentStatus.LABEL_READY, [FulfillmentStatus.LABEL_PRINTED]],
  [FulfillmentStatus.LABEL_PRINTED, [FulfillmentStatus.WAITING_PICKUP]],
  [FulfillmentStatus.WAITING_PICKUP, [FulfillmentStatus.PICKED_UP, FulfillmentStatus.LABEL_READY]], // can go back if pickup fails
  [FulfillmentStatus.PICKED_UP, [FulfillmentStatus.SHIPPING]],
  [FulfillmentStatus.SHIPPING, [FulfillmentStatus.DELIVERED]],
  [FulfillmentStatus.DELIVERED, []],
]);

const REGULAR_PICKUP_TRANSITIONS: Map<FulfillmentStatus, FulfillmentStatus[]> = new Map([
  [FulfillmentStatus.NONE, [FulfillmentStatus.PACKING]],
  [FulfillmentStatus.PACKING, [FulfillmentStatus.READY_TO_SHIP, FulfillmentStatus.NONE]],
  [FulfillmentStatus.READY_TO_SHIP, [FulfillmentStatus.SHIPPING_SETUP, FulfillmentStatus.PACKING]],
  [FulfillmentStatus.SHIPPING_SETUP, [FulfillmentStatus.BOOKING_PICKUP]],
  [FulfillmentStatus.BOOKING_PICKUP, [FulfillmentStatus.BOOKING_SUCCESS, FulfillmentStatus.SHIPPING_SETUP]], // booking failed, back to setup
  [FulfillmentStatus.BOOKING_SUCCESS, [FulfillmentStatus.AWB_GENERATED]],
  [FulfillmentStatus.AWB_GENERATED, [FulfillmentStatus.LABEL_READY]],
  [FulfillmentStatus.LABEL_READY, [FulfillmentStatus.LABEL_PRINTED]],
  [FulfillmentStatus.LABEL_PRINTED, [FulfillmentStatus.WAITING_PICKUP]],
  [FulfillmentStatus.WAITING_PICKUP, [FulfillmentStatus.PICKED_UP, FulfillmentStatus.LABEL_READY]],
  [FulfillmentStatus.PICKED_UP, [FulfillmentStatus.SHIPPING]],
  [FulfillmentStatus.SHIPPING, [FulfillmentStatus.DELIVERED]],
  [FulfillmentStatus.DELIVERED, []],
]);

const REGULAR_DROPOFF_TRANSITIONS: Map<FulfillmentStatus, FulfillmentStatus[]> = new Map([
  [FulfillmentStatus.NONE, [FulfillmentStatus.PACKING]],
  [FulfillmentStatus.PACKING, [FulfillmentStatus.READY_TO_SHIP, FulfillmentStatus.NONE]],
  [FulfillmentStatus.READY_TO_SHIP, [FulfillmentStatus.SHIPPING_SETUP, FulfillmentStatus.PACKING]],
  [FulfillmentStatus.SHIPPING_SETUP, [FulfillmentStatus.AWB_GENERATED]], // skip booking pickup for drop-off
  [FulfillmentStatus.AWB_GENERATED, [FulfillmentStatus.LABEL_READY]],
  [FulfillmentStatus.LABEL_READY, [FulfillmentStatus.LABEL_PRINTED]],
  [FulfillmentStatus.LABEL_PRINTED, [FulfillmentStatus.WAITING_PICKUP]], // "waiting" = seller brings to outlet
  [FulfillmentStatus.WAITING_PICKUP, [FulfillmentStatus.PICKED_UP, FulfillmentStatus.LABEL_READY]],
  [FulfillmentStatus.PICKED_UP, [FulfillmentStatus.SHIPPING]],
  [FulfillmentStatus.SHIPPING, [FulfillmentStatus.DELIVERED]],
  [FulfillmentStatus.DELIVERED, []],
]);

/**
 * Get the allowed transitions map based on shipping method and handover method.
 */
function getTransitionMap(
  shippingMethod?: string,
  handoverMethod?: string,
): Map<FulfillmentStatus, FulfillmentStatus[]> {
  if (shippingMethod === ShippingMethod.INSTANT || shippingMethod === ShippingMethod.SAME_DAY) {
    return INSTANT_TRANSITIONS;
  }
  if (handoverMethod === 'DROP_OFF') {
    return REGULAR_DROPOFF_TRANSITIONS;
  }
  // Default: regular + pickup
  return REGULAR_PICKUP_TRANSITIONS;
}

/**
 * Validate if a fulfillment state transition is allowed.
 * Throws Error with clear message if invalid.
 */
export function validateFulfillmentTransition(
  currentStatus: string,
  newStatus: string,
  shippingMethod?: string,
  handoverMethod?: string,
): void {
  if (currentStatus === newStatus) {
    throw new Error(`Fulfillment status already ${currentStatus}.`);
  }

  // Validate statuses exist
  const fromKeys = Object.values(FulfillmentStatus) as string[];
  if (!fromKeys.includes(currentStatus)) {
    throw new Error(`Unknown fulfillment status: ${currentStatus}`);
  }
  if (!fromKeys.includes(newStatus)) {
    throw new Error(`Unknown fulfillment status: ${newStatus}`);
  }

  const transitionMap = getTransitionMap(shippingMethod, handoverMethod);
  const allowed = transitionMap.get(currentStatus as FulfillmentStatus);

  if (!allowed) {
    throw new Error(
      `Fulfillment status ${currentStatus} has no allowed transitions.`,
    );
  }

  if (!allowed.includes(newStatus as FulfillmentStatus)) {
    throw new Error(
      `Invalid fulfillment transition: ${currentStatus} → ${newStatus}.`,
    );
  }
}

/**
 * Check if a label can be printed based on current fulfillment status.
 */
export function canPrintLabel(fulfillmentStatus: string): boolean {
  return fulfillmentStatus === FulfillmentStatus.LABEL_READY;
}

/**
 * Check if a shipping label can be generated (AWB exists AND snapshot exists).
 */
export function canGenerateLabel(awbNumber: string | null | undefined, snapshotExists: boolean): boolean {
  return !!awbNumber && snapshotExists;
}

/**
 * Get the next expected fulfillment step for user-facing hints.
 */
export function getNextFulfillmentStep(status: string, shippingMethod?: string, handoverMethod?: string): string {
  switch (status) {
    case FulfillmentStatus.NONE:
      return 'Mulai packing pesanan';
    case FulfillmentStatus.PACKING:
      if (shippingMethod === ShippingMethod.INSTANT || shippingMethod === ShippingMethod.SAME_DAY) {
        return 'Cari driver untuk pengiriman instant';
      }
      return 'Atur pengiriman';
    case FulfillmentStatus.READY_TO_SHIP:
      return 'Pilih metode penyerahan (Pickup Kurir / Antar ke Outlet)';
    case FulfillmentStatus.SHIPPING_SETUP:
      if (handoverMethod === 'DROP_OFF') {
        return 'Generate AWB untuk pengiriman';
      }
      return 'Booking pickup kurir';
    case FulfillmentStatus.DRIVER_SEARCHING:
      return 'Menunggu driver ditemukan...';
    case FulfillmentStatus.DRIVER_FOUND:
    case FulfillmentStatus.BOOKING_SUCCESS:
      return 'Cetak label pengiriman';
    case FulfillmentStatus.AWB_GENERATED:
      return 'Cetak label pengiriman';
    case FulfillmentStatus.LABEL_READY:
    case FulfillmentStatus.LABEL_PRINTED:
      return 'Tempel label pada paket';
    case FulfillmentStatus.WAITING_PICKUP:
      if (handoverMethod === 'DROP_OFF') {
        return 'Bawa paket ke outlet ekspedisi';
      }
      return 'Menunggu kurir mengambil paket';
    case FulfillmentStatus.PICKED_UP:
    case FulfillmentStatus.SHIPPING:
      return 'Paket dalam perjalanan';
    case FulfillmentStatus.DELIVERED:
      return 'Paket telah terkirim';
    default:
      return '';
  }
}