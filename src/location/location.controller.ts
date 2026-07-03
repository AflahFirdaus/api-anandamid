import { Controller, Post, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { LocationResolverService } from './services/location-resolver.service';
import { JwtUserGuard } from '../user/guards/jwt-user.guard';

class ResolveLocationDto {
  latitude: number;
  longitude: number;
}

@ApiTags('Location')
@Controller('location')
export class LocationController {
  constructor(private readonly locationResolver: LocationResolverService) {}

  @UseGuards(JwtUserGuard)
  @Post('resolve')
  @ApiOperation({
    summary: 'Resolve coordinates to full location details',
    description:
      'Takes latitude/longitude and returns province, city, district, subdistrict, postal code, and Biteship Area ID.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', example: -7.447 },
        longitude: { type: 'number', example: 112.718 },
      },
      required: ['latitude', 'longitude'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Location resolved successfully',
    schema: {
      type: 'object',
      properties: {
        province: { type: 'string', example: 'Daerah Istimewa Yogyakarta' },
        city: { type: 'string', example: 'Sleman' },
        district: { type: 'string', example: 'Depok' },
        subdistrict: { type: 'string', example: 'Caturtunggal' },
        postalCode: { type: 'string', example: '55281' },
        areaId: { type: 'string', example: '5f8a7b3c-2d1e-4f6a-8c9b-0d1e2f3a4b5c' },
        latitude: { type: 'number', example: -7.447 },
        longitude: { type: 'number', example: 112.718 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid coordinates or location resolution failed' })
  async resolve(@Body() dto: ResolveLocationDto) {
    if (!dto.latitude || !dto.longitude) {
      throw new HttpException('latitude and longitude are required', HttpStatus.BAD_REQUEST);
    }

    if (dto.latitude < -90 || dto.latitude > 90) {
      throw new HttpException('latitude must be between -90 and 90', HttpStatus.BAD_REQUEST);
    }

    if (dto.longitude < -180 || dto.longitude > 180) {
      throw new HttpException('longitude must be between -180 and 180', HttpStatus.BAD_REQUEST);
    }

    return this.locationResolver.resolve(dto.latitude, dto.longitude);
  }
}