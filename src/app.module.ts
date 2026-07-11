import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductModule } from './product/product.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmConfig } from './config/database.config';
import { CategoryModule } from './category/category.module';
import { ProductImageModule } from './product-image/product-image.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ProductImportModule } from './product-import/product-import.module';
import { PricelistModule } from './pricelist/pricelist.module';
import { BannerImageModule } from './banner/banner.module';
import { CertificateModule } from './certificate/certificate.module';
import { GroupingModule } from './grouping/grouping.module';
import { BrandModule } from './brand/brand.module';
import { ImageDownloadController } from './image-download/image-download.controller';
import { ImageDownloadService } from './image-download/image-download.service';
import { ImageDownloadModule } from './image-download/image-download.module';
import { ContactModule } from './contact/contact.module';
import { TiktokModule } from './tiktok/tiktok.module';
import { UserService } from './user/user.service';
import { UserModule } from './user/user.module';
import { CartModule } from './cart/cart.module';
import { OrderModule } from './order/order.module';
import { ProductVariantModule } from './product/product-variant.module';
import { HotlinkProtectionMiddleware } from './middleware/hotlink-protection.middleware';
import { ChatModule } from './chat/chat.module';
import { SitemapModule } from './sitemap/sitemap.module';
import { ThrottlerModule } from './common/throttler';
import { PaymentModule } from './payment/payment.module';
import { ShippingModule } from './shipping/shipping.module';
import { LocationModule } from './location/location.module';
import { ReviewModule } from './review/review.module';
import { VoucherModule } from './voucher/voucher.module';
import { ShipmentModule } from './shipment/shipment.module';
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        TypeOrmConfig(configService),
    }),
    ProductModule,
    CategoryModule,
    ProductImageModule,
    AuthModule,
    AdminModule,
    ProductImportModule,
    PricelistModule,
    BannerImageModule,
    CertificateModule,
    GroupingModule,
    BrandModule,
    ImageDownloadModule,
    ContactModule,
    TiktokModule,
    UserModule,
    CartModule,
    OrderModule,
    ProductVariantModule,
    ThrottlerModule,
    ChatModule,
    SitemapModule,
    PaymentModule,
    ShippingModule,
    LocationModule,
    ReviewModule,
    VoucherModule,
    ShipmentModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HotlinkProtectionMiddleware).forRoutes('*');
  }
}
