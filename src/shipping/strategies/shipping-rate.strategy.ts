export interface ShippingRateRequest {
  originAreaId?: string;
  destinationAreaId?: string;
  originLatitude?: number;
  originLongitude?: number;
  destinationLatitude?: number;
  destinationLongitude?: number;
  originPostalCode?: string | number;
  destinationPostalCode?: string | number;
  couriers: string;
  items: any[];
}

export interface ShippingRateStrategy {
  supports(courier: string): boolean;
  buildRequest(request: ShippingRateRequest): any;
  getEndpoint(): string;
}