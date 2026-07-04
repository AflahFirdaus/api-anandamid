import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { Order } from '../order/entities/order.entity';
import { ProductVariant } from '../product/entities/product-variant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, ProductVariant])],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
