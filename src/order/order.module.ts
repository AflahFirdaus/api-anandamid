import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { ShippingLabelService } from './shipping-label.service';
import { FulfillmentService } from './fulfillment.service';
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
  ],
  controllers: [OrderController],
  providers: [OrderService, ShippingLabelService, FulfillmentService],
  exports: [OrderService, ShippingLabelService, FulfillmentService],
})
export class OrderModule {}
