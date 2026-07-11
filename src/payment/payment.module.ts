import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { Order } from '../order/entities/order.entity';
import { OrderHistory } from '../order/entities/order-history.entity';
import { InventoryHistory } from '../order/entities/inventory-history.entity';
import { ProductVariant } from '../product/entities/product-variant.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderHistory, InventoryHistory, ProductVariant]),
    NotificationModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
