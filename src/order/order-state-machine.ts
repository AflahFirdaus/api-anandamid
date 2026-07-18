/**
 * Order State Machine - Validates all status transitions.
 * Prevents invalid transitions like PENDING → SELESAI or DIKEMAS → LUNAS.
 */

// All valid statuses
export const ORDER_STATUSES = [
  'PENDING',
  'LUNAS',
  'DIKEMAS',
  'SIAP',
  'DIKIRIM',
  'SELESAI',
  'BATAL',
  'CANCEL_REQUESTED',
  'REFUNDING',
  'REFUND_FAILED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Allowed transitions map
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['LUNAS', 'BATAL'],
  LUNAS: ['DIKEMAS', 'BATAL', 'CANCEL_REQUESTED'],
  DIKEMAS: ['SIAP', 'DIKIRIM', 'BATAL'],
  SIAP: ['DIKIRIM', 'SELESAI', 'BATAL'],
  DIKIRIM: ['SELESAI'],
  SELESAI: [],
  BATAL: [],
  CANCEL_REQUESTED: ['REFUNDING', 'REFUND_FAILED', 'CANCELLED', 'BATAL'],
  REFUNDING: ['CANCELLED', 'REFUND_FAILED'],
  REFUND_FAILED: ['REFUNDING', 'CANCELLED'],
  CANCELLED: [],
};

/**
 * Validate if a status transition is allowed.
 * Throws BadRequestException with clear message if invalid.
 */
export function validateStatusTransition(
  currentStatus: string,
  newStatus: string,
): void {
  if (currentStatus === newStatus) {
    throw new Error(`Status sudah ${currentStatus}. Tidak ada perubahan.`);
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed) {
    throw new Error(`Status ${currentStatus} tidak dikenal.`);
  }

  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Transisi status tidak valid: ${currentStatus} → ${newStatus}. ` +
        `Hanya dapat diubah ke: ${allowed.join(', ') || 'tidak ada'}.`,
    );
  }
}

/**
 * Get human-readable label for order status.
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Belum Bayar',
    LUNAS: 'Dibayar',
    DIKEMAS: 'Dikemas',
    SIAP: 'Siap',
    DIKIRIM: 'Dikirim',
    SELESAI: 'Selesai',
    BATAL: 'Dibatalkan',
    CANCEL_REQUESTED: 'Pembatalan Diminta',
    REFUNDING: 'Refund Diproses',
    REFUND_FAILED: 'Refund Gagal',
    CANCELLED: 'Dibatalkan (Refund)',
  };
  return labels[status] || status;
}

// ── Booking Status Machine ──

export const BOOKING_STATUSES = [
  'NOT_BOOKED',
  'BOOKING',
  'BOOKED',
  'FAILED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const ALLOWED_BOOKING_TRANSITIONS: Record<string, string[]> = {
  NOT_BOOKED: ['BOOKING', 'FAILED'],
  BOOKING: ['BOOKED', 'FAILED'],
  BOOKED: ['BOOKING', 'FAILED'], // allow retry if needed
  FAILED: ['BOOKING'], // allow retry from failure
};

/**
 * Validate booking status transition for idempotency.
 */
export function validateBookingTransition(
  currentStatus: string,
  targetStatus: string,
): void {
  if (currentStatus === 'BOOKING' && targetStatus === 'BOOKING') {
    throw new Error('Booking sedang diproses. Mohon tunggu.');
  }
  if (currentStatus === 'BOOKED' && targetStatus === 'BOOKING') {
    throw new Error(
      'Booking sudah berhasil sebelumnya. Tidak dapat booking ulang.',
    );
  }

  const allowed = ALLOWED_BOOKING_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new Error(
      `Transisi booking tidak valid: ${currentStatus} → ${targetStatus}.`,
    );
  }
}
