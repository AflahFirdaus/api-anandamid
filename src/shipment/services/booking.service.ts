import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from '../entities/shipment.entity';
import { BookingLog } from '../entities/booking-log.entity';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { validateShipmentTransition } from '../shipment-state-machine';
import { TrackingService } from './tracking.service';
import {
  ShipmentBookedEvent,
  ShipmentPickedUpEvent,
  ShipmentDeliveredEvent,
  ShipmentFailedEvent,
  ShipmentRetriedEvent,
} from '../events/shipment.event';

export interface AwbResult {
  biteship_order_id: string;
  awb_number: string;
  awb_url: string;
  driver_info?: Record<string, any>;
  tracking_url?: string;
}

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(BookingLog)
    private readonly bookingLogRepo: Repository<BookingLog>,
    private readonly trackingService: TrackingService,
  ) {}

  /**
   * Record a booking attempt (for audit trail).
   */
  async recordBookingLog(
    shipmentId: string,
    data: {
      attempt_number: number;
      courier: string;
      service: string;
      status: string; // SUCCESS | FAILED | TIMEOUT | DRIVER_REJECT
      awb_number?: string;
      request_payload?: any;
      response_data?: any;
      error_message?: string;
      response_time_ms?: number;
      driver_info?: any;
    },
  ): Promise<BookingLog> {
    const log = this.bookingLogRepo.create({
      shipment_id: shipmentId,
      ...data,
    });
    return this.bookingLogRepo.save(log);
  }

  /**
   * Mark shipment as booked (AWB generated).
   * Uses state machine validation. Emits ShipmentBookedEvent.
   */
  async markBooked(
    shipment: Shipment,
    awbData: AwbResult,
    bookingLogData?: {
      request_payload?: any;
      response_data?: any;
      response_time_ms?: number;
      driver_info?: any;
    },
  ): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.BOOKED);

    shipment.awb_number = awbData.awb_number;
    shipment.awb_url = awbData.awb_url;
    shipment.biteship_order_id = awbData.biteship_order_id;
    shipment.shipment_status = ShipmentStatus.BOOKED;
    if (awbData.tracking_url) shipment.tracking_url = awbData.tracking_url;
    if (awbData.driver_info) shipment.driver_info = awbData.driver_info;

    const saved = await this.shipmentRepo.save(shipment);

    // Tracking event
    await this.trackingService.recordEvent(
      shipment.id,
      'BOOKED',
      `AWB ${awbData.awb_number} generated`,
      undefined,
      { awb: awbData.awb_number, biteship_order_id: awbData.biteship_order_id },
    );

    // Domain event
    const event = new ShipmentBookedEvent(
      shipment.id, shipment.order_id, awbData.awb_number,
      shipment.courier_name || '', shipment.courier_service || '',
    );

    this.logger.log(`[BOOKING] shipment=${shipment.id} awb=${awbData.awb_number} status=BOOKED`);
    return saved;
  }

  /**
   * Generate AWB for REGULAR shipping via Biteship API.
   * Moved from OrderService — ShipmentModule is now the single owner of Biteship calls.
   */
  async generateAWB(
    courierName: string,
    courierService: string,
    destInfo: {
      recipient_name: string;
      recipient_phone: string;
      full_address: string;
      postal_code: string;
      area_id?: string;
      latitude?: string;
      longitude?: string;
    },
    items: Array<{
      product_name: string;
      quantity: number;
      price: number;
      weight: number;
      length?: number;
      width?: number;
      height?: number;
    }>,
    storeConfig?: {
      name?: string;
      phone?: string;
      address?: string;
      postal_code?: string;
      area_id?: string;
      latitude?: number;
      longitude?: number;
    },
  ): Promise<AwbResult | null> {
    const key = process.env.BITESHIP_API_KEY || '';
    if (!key) {
      this.logger.warn('[AWB] No Biteship API key');
      return null;
    }

    const originName = storeConfig?.name || process.env.STORE_CONTACT_NAME || 'Anandam Computer';
    const originPhone = storeConfig?.phone || process.env.STORE_PHONE || '6281228134747';
    const originAddr = storeConfig?.address || process.env.STORE_ADDRESS || 'Jl. Ringroad Selatan, Banguntapan, Bantul, Yogyakarta';
    const originPC = storeConfig?.postal_code || process.env.STORE_POSTAL_CODE || '55283';
    const originArea = storeConfig?.area_id || process.env.STORE_AREA_ID || '';
    const originLat = storeConfig?.latitude || parseFloat(process.env.STORE_LATITUDE || '-7.8300');
    const originLng = storeConfig?.longitude || parseFloat(process.env.STORE_LONGITUDE || '110.3870');

    const courier = this.normalizeCourierCode(courierName);
    const svc = this.extractCourierType(courier, courierService);

    const body: any = {
      origin_contact_name: originName,
      origin_contact_phone: originPhone,
      origin_address: originAddr,
      origin_postal_code: parseInt(originPC, 10) || 55283,
      origin_coordinate: { latitude: originLat, longitude: originLng },
      destination_contact_name: destInfo.recipient_name,
      destination_contact_phone: destInfo.recipient_phone,
      destination_address: destInfo.full_address || 'Alamat Tujuan',
      destination_postal_code: parseInt(destInfo.postal_code, 10) || 55283,
      courier_company: courier,
      courier_type: svc,
      delivery_type: 'now',
      items: items.map((item) => ({
        name: item.product_name || 'Product',
        value: Math.max(Number(item.price) || 1000, 100),
        quantity: item.quantity,
        weight: Math.max(Math.round((item.weight || 1000) * item.quantity), 100),
        length: Number(item.length) || 20,
        width: Number(item.width) || 20,
        height: Number(item.height) || 20,
      })),
    };

    if (originArea) body.origin_area_id = originArea;
    if (destInfo.area_id) body.destination_area_id = destInfo.area_id;
    if (destInfo.latitude && destInfo.longitude) {
      body.destination_coordinate = {
        latitude: parseFloat(destInfo.latitude),
        longitude: parseFloat(destInfo.longitude),
      };
    }

    this.logger.log(`[AWB] Sending: courier=${courier}, type=${svc}, originArea=${originArea}, destArea=${destInfo.area_id}`);

    try {
      const res = await fetch('https://api.biteship.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      this.logger.log(`[AWB] Response ${res.status}: ${JSON.stringify(data).substring(0, 300)}`);

      if (!res.ok) {
        this.logger.error(`[AWB] FAIL: ${JSON.stringify(data)}`);
        return null;
      }

      const biteshipOrderId = data.id || '';
      const awb = data.waybill_id || data.courier?.waybill_id || '';
      const url = data.waybill_url || data.courier?.waybill_url || '';

      this.logger.log(`[AWB] SUCCESS! biteshipOrderId=${biteshipOrderId}, AWB=${awb}`);
      return { biteship_order_id: biteshipOrderId, awb_number: awb, awb_url: url };
    } catch (e: any) {
      this.logger.error(`[AWB] Network error: ${e.message}`);
      return null;
    }
  }

  /**
   * Generate instant booking for INSTANT/SAME_DAY shipping via Biteship.
   */
  async generateInstantBooking(
    courierName: string,
    destInfo: {
      recipient_name: string;
      recipient_phone: string;
      full_address: string;
      latitude: string;
      longitude: string;
      postal_code?: string;
    },
    items: Array<{
      product_name: string;
      quantity: number;
      price: number;
      weight: number;
      length?: number;
      width?: number;
      height?: number;
    }>,
    storeConfig?: {
      name?: string;
      phone?: string;
      address?: string;
      postal_code?: string;
      latitude?: number;
      longitude?: number;
    },
  ): Promise<AwbResult | null> {
    const key = process.env.BITESHIP_API_KEY || '';
    if (!key) return null;

    const originName = storeConfig?.name || process.env.STORE_CONTACT_NAME || 'Anandam Computer';
    const originPhone = storeConfig?.phone || process.env.STORE_PHONE || '6281228134747';
    const originAddr = storeConfig?.address || process.env.STORE_ADDRESS || 'Jl. Ringroad Selatan';
    const originLat = storeConfig?.latitude || parseFloat(process.env.STORE_LATITUDE || '-7.8300');
    const originLng = storeConfig?.longitude || parseFloat(process.env.STORE_LONGITUDE || '110.3870');

    if (!destInfo.latitude || !destInfo.longitude) {
      this.logger.warn('[INSTANT_BOOKING] No destination coordinates');
      return null;
    }

    const courier = this.normalizeCourierCode(courierName);

    const biteshipBody: any = {
      origin_contact_name: originName,
      origin_contact_phone: originPhone,
      origin_address: originAddr,
      origin_postal_code: parseInt(storeConfig?.postal_code || process.env.STORE_POSTAL_CODE || '55283', 10),
      origin_coordinate: { latitude: originLat, longitude: originLng },
      destination_contact_name: destInfo.recipient_name,
      destination_contact_phone: destInfo.recipient_phone,
      destination_address: destInfo.full_address || 'Alamat Tujuan',
      destination_coordinate: {
        latitude: parseFloat(destInfo.latitude),
        longitude: parseFloat(destInfo.longitude),
      },
      courier_company: courier,
      courier_type: 'instant',
      delivery_type: 'now',
      items: items.map((item) => ({
        name: item.product_name || 'Product',
        value: Math.max(Number(item.price) || 1000, 100),
        quantity: item.quantity,
        weight: Math.max(Math.round((item.weight || 1000) * item.quantity), 100),
        length: Number(item.length) || 20,
        width: Number(item.width) || 20,
        height: Number(item.height) || 20,
      })),
    };

    if (destInfo.postal_code) {
      biteshipBody.destination_postal_code = parseInt(destInfo.postal_code, 10);
    }

    try {
      const res = await fetch('https://api.biteship.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(biteshipBody),
      });
      const data = await res.json();

      if (!res.ok) {
        this.logger.error(`[INSTANT_BOOKING] FAIL: ${JSON.stringify(data)}`);
        return null;
      }

      const result: AwbResult = {
        biteship_order_id: data.id || '',
        awb_number: data.waybill_id || '',
        awb_url: data.waybill_url || '',
      };

      // Attempt to fetch driver info
      try {
        const infoRes = await fetch(`https://api.biteship.com/v1/orders/${data.id}`, {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
        });
        if (infoRes.ok) {
          const infoData = await infoRes.json();
          const driverInfo = infoData.courier || {};
          result.driver_info = {
            driver_name: driverInfo.name || driverInfo.driver_name || null,
            driver_phone: driverInfo.phone || driverInfo.driver_phone || null,
            driver_tracking_url: driverInfo.tracking_url || null,
            driver_vehicle_type: driverInfo.vehicle_type || null,
            driver_photo: driverInfo.photo_url || null,
          };
        }
      } catch {
        // Non-critical — continue without driver info
      }

      this.logger.log(`[INSTANT_BOOKING] SUCCESS! biteshipOrderId=${result.biteship_order_id}, AWB=${result.awb_number}`);
      return result;
    } catch (e: any) {
      this.logger.error(`[INSTANT_BOOKING] Network error: ${e.message}`);
      return null;
    }
  }

  // ── Courier helpers (copied from OrderService) ──

  private normalizeCourierCode(courier: string): string {
    const c = courier.toLowerCase().trim();
    if (c.includes('j&t') || c.includes('j & t') || c === 'jnt' || c.includes('j&t express')) return 'jnt';
    if (c === 'jne' || c.includes('jne')) return 'jne';
    if (c.includes('sicepat') || c === 'scp') return 'sicepat';
    if (c === 'tiki' || c.includes('tiki')) return 'tiki';
    if (c === 'pos' || c.includes('pos indonesia')) return 'pos';
    if (c.includes('anteraja') || c === 'anteraja') return 'anteraja';
    if (c.includes('ninja') || c === 'ninjaxpress') return 'ninjaxpress';
    if (c.includes('wahana') || c === 'wahana') return 'wahana';
    if (c.includes('gojek') || c.includes('gosend') || c === 'gojek') return 'gojek';
    if (c.includes('grab') || c === 'grabexpress') return 'grab';
    return c.replace(/\s+/g, '');
  }

  private extractCourierType(courier: string, rawService: string): string {
    const svc = rawService.toLowerCase();
    const c = this.normalizeCourierCode(courier);
    if (c === 'jne') {
      if (svc.includes('oke')) return 'oke';
      if (svc.includes('yes')) return 'yes';
      if (svc.includes('jtr')) return 'jtr';
      if (svc.includes('ctc')) return 'ctc';
      return 'reg';
    }
    if (c === 'jnt') {
      if (svc.includes('jnd') || svc.includes('next day')) return 'jnd';
      return 'ez';
    }
    if (c === 'sicepat') {
      if (svc.includes('best')) return 'best';
      if (svc.includes('sds') || svc.includes('same day')) return 'sds';
      if (svc.includes('gokil')) return 'gokil';
      return 'reg';
    }
    if (c === 'tiki') {
      if (svc.includes('eco')) return 'eco';
      if (svc.includes('ons') || svc.includes('overnight')) return 'ons';
      if (svc.includes('hds') || svc.includes('same day')) return 'hds';
      return 'reg';
    }
    if (c === 'pos') {
      if (svc.includes('express') || svc.includes('next day')) return 'express next day';
      return 'pos kilat khusus';
    }
    if (c === 'anteraja') {
      if (svc.includes('next day') || svc.includes('nd')) return 'next_day';
      if (svc.includes('same day') || svc.includes('sd')) return 'same_day';
      return 'reguler';
    }
    if (svc.includes('regular') || svc.includes('reguler')) return 'reg';
    if (svc.includes('express')) return 'express';
    if (svc.includes('instant')) return 'instant';
    if (svc.includes('same day') || svc.includes('sameday')) return 'same_day';
    if (/^[a-z_]+$/.test(svc) && svc.length <= 20) return svc;
    return 'reg';
  }

  // ── Existing methods ──

  async markPickedUp(shipment: Shipment, location?: string): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.PICKED_UP);
    shipment.shipment_status = ShipmentStatus.PICKED_UP;
    shipment.picked_up_at = new Date();
    const saved = await this.shipmentRepo.save(shipment);
    await this.trackingService.recordEvent(shipment.id, 'PICKUP', 'Package picked up by courier', location);
    return saved;
  }

  async markInTransit(shipment: Shipment, location?: string): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.IN_TRANSIT);
    shipment.shipment_status = ShipmentStatus.IN_TRANSIT;
    const saved = await this.shipmentRepo.save(shipment);
    await this.trackingService.recordEvent(shipment.id, 'TRANSIT', 'Package in transit', location);
    return saved;
  }

  async markDelivered(shipment: Shipment, location?: string): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.DELIVERED);
    shipment.shipment_status = ShipmentStatus.DELIVERED;
    shipment.delivered_at = new Date();
    const saved = await this.shipmentRepo.save(shipment);
    await this.trackingService.recordEvent(shipment.id, 'DELIVERED', 'Package delivered', location);
    return saved;
  }

  async markFailed(shipment: Shipment, reason: string): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.FAILED);
    shipment.shipment_status = ShipmentStatus.FAILED;
    shipment.failed_at = new Date();
    shipment.failure_reason = reason;
    shipment.retry_count = (shipment.retry_count || 0) + 1;
    const saved = await this.shipmentRepo.save(shipment);
    await this.trackingService.recordEvent(shipment.id, 'FAILED', reason);
    this.logger.warn(`[BOOKING] shipment=${shipment.id} status=FAILED reason=${reason}`);
    return saved;
  }

  async retry(shipment: Shipment): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.PENDING);
    shipment.shipment_status = ShipmentStatus.PENDING;
    shipment.failed_at = null as any;
    shipment.failure_reason = null as any;
    shipment.awb_number = null as any;
    shipment.awb_url = null as any;
    shipment.biteship_order_id = null as any;
    const saved = await this.shipmentRepo.save(shipment);
    await this.trackingService.recordEvent(shipment.id, 'RETRY', `Retry attempt #${shipment.retry_count}`);
    return saved;
  }
}