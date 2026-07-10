/**
 * Domain Events for Shipment module.
 * Other modules subscribe to these events instead of calling services directly.
 */

export class ShipmentCreatedEvent {
  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly shippingMethod: string,
  ) {}
}

export class ShipmentBookedEvent {
  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly awbNumber: string,
    public readonly courier: string,
    public readonly service: string,
  ) {}
}

export class ShipmentLabelReadyEvent {
  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly awbNumber: string,
  ) {}
}

export class ShipmentLabelPrintedEvent {
  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly printCount: number,
    public readonly printedBy: string,
  ) {}
}

export class ShipmentPickedUpEvent {
  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly awbNumber: string,
    public readonly location?: string,
  ) {}
}

export class ShipmentDeliveredEvent {
  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly awbNumber: string,
  ) {}
}

export class ShipmentFailedEvent {
  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly reason: string,
    public readonly awbNumber?: string,
  ) {}
}

export class ShipmentRetriedEvent {
  constructor(
    public readonly shipmentId: string,
    public readonly orderId: string,
    public readonly attemptCount: number,
  ) {}
}