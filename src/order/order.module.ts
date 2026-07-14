import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { OrderCronService } from './order-cron.service';
import { ShippingLabelService } from './shipping-label.service';
import { FulfillmentService } from './fulfillment.service';
import { FulfillmentWorkflowService } from './fulfillment-workflow.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderHistory } from './entities/order-history.entity';
import { InventoryHistory } from './entities/inventory-history.entity';
import { Cart } from '../cart/entities/cart.entity';
import { Product } from '../product/entities/product.entity';
import { ProductVariant } from '../product/entities/product-variant.entity';
import { User } from '../user/entities/user.entity';
import { UserAddress } from '../user/entities/user-address.entity';
import { PaymentModule } from '../payment/payment.module';
import { VoucherModule } from '../voucher/voucher.module';
import { ShipmentModule } from '../shipment/shipment.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderHistory,
      InventoryHistory,
      Cart,
      Product,
      ProductVariant,
      User,
      UserAddress,
    ]),
    PaymentModule,
    VoucherModule,
    forwardRef(() => ShipmentModule),
    NotificationModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderCronService, ShippingLabelService, FulfillmentService, FulfillmentWorkflowService],
  exports: [OrderService, OrderCronService, ShippingLabelService, FulfillmentService, FulfillmentWorkflowService],
})
export class OrderModule {}
