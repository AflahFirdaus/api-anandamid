import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Outbox } from '../entities/outbox.entity';

/**
 * Outbox Service — implements the Outbox Pattern for reliable event publishing.
 * 
 * Flow:
 * 1. Business logic saves aggregate + outbox record in same transaction
 * 2. Worker picks up PENDING outbox records
 * 3. Worker publishes event to message broker / event bus
 * 4. Worker marks outbox as PUBLISHED
 * 
 * If server crashes after step 1 but before step 3, the outbox record persists.
 * Worker will pick it up on next poll.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(Outbox)
    private readonly outboxRepo: Repository<Outbox>,
  ) {}

  /**
   * Create an outbox record (inside the same transaction as the aggregate).
   */
  async create(
    eventType: string,
    payload: Record<string, any>,
    aggregateType?: string,
    aggregateId?: string,
    transactionId?: string,
  ): Promise<Outbox> {
    const outbox = this.outboxRepo.create({
      event_type: eventType,
      payload,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      transaction_id: transactionId,
      status: 'PENDING',
    });
    return this.outboxRepo.save(outbox);
  }

  /**
   * Worker: get pending outbox records (batch).
   */
  async getPending(limit: number = 50): Promise<Outbox[]> {
    return this.outboxRepo.find({
      where: { status: 'PENDING' },
      order: { created_at: 'ASC' },
      take: limit,
    });
  }

  /**
   * Worker: mark outbox as published.
   */
  async markPublished(id: string): Promise<void> {
    await this.outboxRepo.update(id, {
      status: 'PUBLISHED',
      published_at: new Date(),
    });
  }

  /**
   * Worker: mark outbox as failed.
   */
  async markFailed(id: string, error: string): Promise<void> {
    await this.outboxRepo.update(id, {
      status: 'FAILED',
      error_message: error,
      retry_count: () => 'retry_count + 1',
    });
  }

  /**
   * Cleanup: delete old published records (older than 7 days).
   */
  async cleanup(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await this.outboxRepo.delete({
      status: 'PUBLISHED',
      created_at: LessThan(sevenDaysAgo),
    });
    return result.affected || 0;
  }
}