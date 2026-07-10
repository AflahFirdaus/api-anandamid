import { ShipmentStatus } from './enums/shipment-status.enum';

/**
 * Shipment State Machine — validates all shipment status transitions.
 * All BookingService/LabelService/ShipmentService must go through this.
 */

// Allowed transitions map
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  [ShipmentStatus.PENDING]: [ShipmentStatus.BOOKED, ShipmentStatus.FAILED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.BOOKED]: [ShipmentStatus.PICKED_UP, ShipmentStatus.FAILED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.PICKED_UP]: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.FAILED],
  [ShipmentStatus.IN_TRANSIT]: [ShipmentStatus.DELIVERED, ShipmentStatus.FAILED],
  [ShipmentStatus.DELIVERED]: [],  // Terminal state
  [ShipmentStatus.FAILED]: [ShipmentStatus.PENDING], // Retry
  [ShipmentStatus.CANCELLED]: [], // Terminal state
};

/**
 * Validate if a shipment status transition is allowed.
 * Throws Error with clear message if invalid.
 */
export function validateShipmentTransition(
  currentStatus: string,
  newStatus: string,
): void {
  if (currentStatus === newStatus) {
    throw new Error(`Shipment status already ${currentStatus}.`);
  }

  // Validate statuses exist
  const validStatuses = Object.values(ShipmentStatus) as string[];
  if (!validStatuses.includes(currentStatus)) {
    throw new Error(`Unknown shipment status: ${currentStatus}`);
  }
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Unknown shipment status: ${newStatus}`);
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed) {
    throw new Error(`Shipment status ${currentStatus} has no allowed transitions.`);
  }
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid shipment transition: ${currentStatus} → ${newStatus}. ` +
      `Allowed: ${allowed.join(', ') || 'none'}.`,
    );
  }
}

/**
 * Get human-readable label for shipment status.
 */
export function getShipmentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    [ShipmentStatus.PENDING]: 'Menunggu',
    [ShipmentStatus.BOOKED]: 'Booking Berhasil',
    [ShipmentStatus.PICKED_UP]: 'Sudah Diambil Kurir',
    [ShipmentStatus.IN_TRANSIT]: 'Dalam Perjalanan',
    [ShipmentStatus.DELIVERED]: 'Terkirim',
    [ShipmentStatus.FAILED]: 'Gagal',
    [ShipmentStatus.CANCELLED]: 'Dibatalkan',
  };
  return labels[status] || status;
}