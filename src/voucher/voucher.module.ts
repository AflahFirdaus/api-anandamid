import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VoucherController } from './voucher.controller';
import { AdminVoucherController } from './admin-voucher.controller';
import { VoucherService } from './voucher.service';
import { VoucherCronService } from './voucher-cron.service';
import { Voucher } from './entities/voucher.entity';
import { VoucherUsage } from './entities/voucher-usage.entity';
import { UserVoucherEligibility } from './entities/user-voucher-eligibility.entity';
import { Order } from '../order/entities/order.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Voucher,
      VoucherUsage,
      UserVoucherEligibility,
      Order,
    ]),
  ],
  controllers: [VoucherController, AdminVoucherController],
  providers: [VoucherService, VoucherCronService],
  exports: [VoucherService],
})
export class VoucherModule {}
