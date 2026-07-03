import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { RegularCourierStrategy } from './strategies/regular-courier.strategy';
import { InstantCourierStrategy } from './strategies/instant-courier.strategy';
import { UserAddress } from '../user/entities/user-address.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserAddress])],
  controllers: [ShippingController],
  providers: [
    ShippingService,
    RegularCourierStrategy,
    InstantCourierStrategy,
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
