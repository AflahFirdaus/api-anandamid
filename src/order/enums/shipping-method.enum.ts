/**
 * Shipping Method — determines the fulfillment pipeline.
 * Stored on the Order for internal business logic.
 */
export enum ShippingMethod {
  INSTANT = 'INSTANT',
  SAME_DAY = 'SAME_DAY',
  REGULAR = 'REGULAR',
}

export const SHIPPING_METHODS = Object.values(ShippingMethod);