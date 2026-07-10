import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookLog } from '../entities/webhook-log.entity';

/**
 * Webhook Log Service — records every incoming webhook for audit trail.
 * All webhook handlers should call this service.
 */
@Injectable()
export class WebhookLogService {
  private readonly logger = new Logger(WebhookLogService.name);

  constructor(
    @InjectRepository(WebhookLog)
    private readonly webhookLogRepo: Repository<WebhookLog>,
  ) {}

  /**
   * Record an incoming webhook.
   */
  async record(data: {
    provider: string;
    endpoint: string;
    ip_address?: string;
    headers?: Record<string, any>;
    payload?: Record<string, any>;
    idempotency_key?: string;
    reference_id?: string;
  }): Promise<WebhookLog> {
    const log = this.webhookLogRepo.create({
      provider: data.provider,
      endpoint: data.endpoint,
      ip_address: data.ip_address,
      headers: data.headers,
      payload: data.payload,
      idempotency_key: data.idempotency_key,
      reference_id: data.reference_id,
      processing_status: 'PENDING',
    });
    return this.webhookLogRepo.save(log);
  }

  /**
   * Mark webhook as processed successfully.
   */
  async markSuccess(
    id: string,
    response?: Record<string, any>,
    httpStatus?: number,
    processingTimeMs?: number,
  ): Promise<void> {
    await this.webhookLogRepo.update(id, {
      processing_status: 'SUCCESS',
      response,
      http_status: httpStatus,
      processing_time_ms: processingTimeMs,
      processed_at: new Date(),
    });
  }

  /**
   * Mark webhook as failed.
   */
  async markFailed(
    id: string,
    error: string,
    response?: Record<string, any>,
    httpStatus?: number,
  ): Promise<void> {
    await this.webhookLogRepo.update(id, {
      processing_status: 'FAILED',
      error_message: error,
      response,
      http_status: httpStatus,
      processed_at: new Date(),
    });
  }

  /**
   * Check if a webhook with the given idempotency key was already processed.
   */
  async isDuplicate(idempotencyKey: string): Promise<boolean> {
    const existing = await this.webhookLogRepo.findOne({
      where: { idempotency_key: idempotencyKey, processing_status: 'SUCCESS' },
    });
    return !!existing;
  }

  /**
   * Get webhook logs for a reference (order/shipment).
   */
  async getByReference(referenceId: string): Promise<WebhookLog[]> {
    return this.webhookLogRepo.find({
      where: { reference_id: referenceId },
      order: { received_at: 'DESC' },
    });
  }
}