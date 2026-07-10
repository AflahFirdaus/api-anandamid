import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from '../entities/shipment.entity';
import { LabelStatus } from '../enums/label-status.enum';
import { TrackingService } from './tracking.service';

@Injectable()
export class LabelService {
  private readonly logger = new Logger(LabelService.name);

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    private readonly trackingService: TrackingService,
  ) {}

  /**
   * Mark label as ready (AWB + snapshot exist).
   */
  async markReady(shipment: Shipment): Promise<Shipment> {
    if (!shipment.awb_number) {
      throw new BadRequestException('AWB belum tersedia.');
    }
    shipment.label_status = LabelStatus.READY;
    const saved = await this.shipmentRepo.save(shipment);

    await this.trackingService.recordEvent(
      shipment.id,
      'LABEL_READY',
      'Shipping label ready',
    );

    return saved;
  }

  /**
   * Mark label as printed.
   */
  async markPrinted(shipment: Shipment, printedBy?: string): Promise<Shipment> {
    if (shipment.label_status !== LabelStatus.READY) {
      throw new BadRequestException('Label belum siap dicetak.');
    }

    const now = new Date();
    shipment.label_print_count = (shipment.label_print_count || 0) + 1;
    shipment.label_status = shipment.label_print_count > 1 ? LabelStatus.REPRINTED : LabelStatus.PRINTED;
    shipment.last_label_printed_at = now;
    shipment.printed_at = now;
    if (printedBy) shipment.printed_by = printedBy;

    const saved = await this.shipmentRepo.save(shipment);

    await this.trackingService.recordEvent(
      shipment.id,
      'LABEL_PRINTED',
      `Label printed (x${shipment.label_print_count})`,
      undefined,
      { print_count: shipment.label_print_count, printed_by: printedBy },
    );

    this.logger.log(`[LABEL] shipment=${shipment.id} status=${shipment.label_status} count=${shipment.label_print_count}`);
    return saved;
  }

  /**
   * Check if label can be printed.
   */
  canPrint(shipment: Shipment): boolean {
    return shipment.label_status === LabelStatus.READY;
  }
}