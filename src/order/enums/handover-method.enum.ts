/**
 * Handover Method — how the package is handed to the courier.
 * Only applicable for REGULAR shipping.
 * INSTANT shipping always uses PICKUP (driver picks up from store).
 */
export enum HandoverMethod {
  PICKUP = 'PICKUP',
  DROP_OFF = 'DROP_OFF',
}

export const HANDOVER_METHODS = Object.values(HandoverMethod);