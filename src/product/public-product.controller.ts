import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { ProductService } from './product.service';
import { Product } from './entities/product.entity';

@Controller('products')
export class PublicProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  async findAll(@Query() query: any) {
    return this.productService.findActiveProducts(query);
  }

  @Get('compatibility')
  getCompatibility(@Query() query: any) {
    return this.productService.getCompatibilityBuilder(query);
  }

  @Get('hardware-types')
  async getHardwareTypes() {
    return this.productService.getHardwareTypes();
  }

  @Get(':id/recommendations')
  getRecommendations(@Param('id') id: string) {
    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new BadRequestException(
        'Invalid product ID format. Expected a valid UUID.',
      );
    }
    return this.productService.getRecommendations(id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new BadRequestException(
        'Invalid product ID format. Expected a valid UUID.',
      );
    }

    const product = (await this.productService.findOneByParams(
      id,
      true,
    )) as Product;

    if (!product.is_active) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }
}
