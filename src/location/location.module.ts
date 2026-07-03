import { Module } from '@nestjs/common';
import { LocationController } from './location.controller';
import { LocationResolverService } from './services/location-resolver.service';
import { BiteshipLocationResolverService } from './services/biteship-location-resolver.service';

@Module({
  controllers: [LocationController],
  providers: [LocationResolverService, BiteshipLocationResolverService],
  exports: [LocationResolverService],
})
export class LocationModule {}