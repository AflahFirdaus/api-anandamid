import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourierCapability } from '../entities/courier-capability.entity';

@Injectable()
export class CourierCapabilityService {
  private readonly logger = new Logger(CourierCapabilityService.name);

  constructor(
    @InjectRepository(CourierCapability)
    private readonly repo: Repository<CourierCapability>,
  ) {}

  /**
   * Check if a courier supports pickup.
   */
  async supportsPickup(courierCode: string): Promise<boolean> {
    const cap = await this.repo.findOne({ where: { courier_code: courierCode } });
    if (!cap) {
      // Default: assume pickup is supported for most couriers except known ones
      const noPickup = ['pos'];
      return !noPickup.includes(courierCode.toLowerCase());
    }
    return cap.supports_pickup;
  }

  /**
   * Check if a courier supports drop-off.
   */
  async supportsDropOff(courierCode: string): Promise<boolean> {
    const cap = await this.repo.findOne({ where: { courier_code: courierCode } });
    if (!cap) return true; // default true
    return cap.supports_drop_off;
  }

  /**
   * Get all courier capabilities.
   */
  async getAll(): Promise<CourierCapability[]> {
    return this.repo.find();
  }

  /**
   * Seed default courier capabilities.
   */
  async seedDefaults(): Promise<void> {
    const defaults: Partial<CourierCapability>[] = [
      { courier_code: 'jne', courier_name: 'JNE', supports_pickup: true, supports_drop_off: true, supports_instant: false, supports_same_day: false, supports_regular: true },
      { courier_code: 'jnt', courier_name: 'J&T Express', supports_pickup: true, supports_drop_off: true, supports_instant: false, supports_same_day: false, supports_regular: true },
      { courier_code: 'sicepat', courier_name: 'SiCepat', supports_pickup: true, supports_drop_off: true, supports_instant: false, supports_same_day: true, supports_regular: true },
      { courier_code: 'tiki', courier_name: 'TIKI', supports_pickup: true, supports_drop_off: true, supports_instant: false, supports_same_day: false, supports_regular: true },
      { courier_code: 'pos', courier_name: 'POS Indonesia', supports_pickup: false, supports_drop_off: true, supports_instant: false, supports_same_day: false, supports_regular: true },
      { courier_code: 'anteraja', courier_name: 'AnterAja', supports_pickup: true, supports_drop_off: true, supports_instant: false, supports_same_day: true, supports_regular: true },
      { courier_code: 'ninjaxpress', courier_name: 'Ninja Xpress', supports_pickup: true, supports_drop_off: true, supports_instant: false, supports_same_day: false, supports_regular: true },
      { courier_code: 'wahana', courier_name: 'Wahana', supports_pickup: true, supports_drop_off: true, supports_instant: false, supports_same_day: false, supports_regular: true },
      { courier_code: 'gojek', courier_name: 'GoSend', supports_pickup: true, supports_drop_off: false, supports_instant: true, supports_same_day: true, supports_regular: false },
      { courier_code: 'grab', courier_name: 'GrabExpress', supports_pickup: true, supports_drop_off: false, supports_instant: true, supports_same_day: true, supports_regular: false },
    ];

    for (const d of defaults) {
      const existing = await this.repo.findOne({ where: { courier_code: d.courier_code } });
      if (!existing) {
        await this.repo.save(this.repo.create(d));
        this.logger.log(`[COURIER] Seeded capability for ${d.courier_code}`);
      }
    }
  }
}