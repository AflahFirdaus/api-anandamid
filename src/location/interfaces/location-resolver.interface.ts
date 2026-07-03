export interface LocationResult {
  province: string;
  city: string;
  district: string;
  subdistrict: string;
  postalCode: string;
  areaId: string;
  latitude: number;
  longitude: number;
}

export interface LocationResolver {
  resolve(latitude: number, longitude: number): Promise<LocationResult>;
  getAreaId(latitude: number, longitude: number): Promise<string>;
}