import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
  Query,
  Patch,
} from '@nestjs/common';

import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create.product.dto';
import { UpdateProductDto } from './dto/update.product.dto';
import { findOneParams } from './dto/find-one.params';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';
import { GoogleMerchantService } from './google-merchant.service';

@Controller('admin/products') 
@UseGuards(JwtAuthGuard)      
export class AdminProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly googleMerchantService: GoogleMerchantService,
  ) {}

  @Get()
  async findAll(@Query() query: any) {
    return this.productService.findAllProduct(query);
  }

  @Get('analytics/top-viewed')
  async getTopViewed(
    @Query('period') period: 'today' | 'week' | 'month' = 'week',
    @Query('limit') limit = 10
  ) {
    return this.productService.getTopViewedProducts(period, Number(limit));
  }

  @Get('analytics/:id/stats')
  async getProductStats(@Param('id') id: string) {
    return this.productService.getProductViewStats(id);
  }

  @Get(':id')
  async findOne(@Param() params: findOneParams): Promise<any> {
    return this.productService.findOneByParams(params.id, false);
  }

  @Post()
  async create(
    @Body() dto: CreateProductDto,
  ): Promise<any> {
    return this.productService.createProduct(dto);
  }

  @Put(':id')
  async update(
    @Param() params: findOneParams,
    @Body() dto: UpdateProductDto,
  ): Promise<any> {
    return this.productService.updateProductByParams(params.id, dto);
  }

  @Patch(":id/remove-brand")
  removeBrand(@Param("id") id: string) {
    return this.productService.removeBrand(id);
  }

  @Delete('image/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteImage(@Param('imageId') imageId: string): Promise<void> {
    await this.productService.deleteProductImage(imageId);
  }

  @Delete('bulk')
  @HttpCode(HttpStatus.NO_CONTENT)
  async bulkDelete(@Body() body: { ids: string[] }) {
    await this.productService.bulkDelete(body.ids);
  }

  @Delete('bulk/old-duplicates')
  @HttpCode(HttpStatus.OK)
  async bulkDeleteOldDuplicates() {
    return this.productService.bulkDeleteOldDuplicates();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param() params: findOneParams): Promise<void> {
    await this.productService.deleteProductByParams(params.id);
  }

  // ============================================================
  // GOOGLE MERCHANT CENTER
  // ============================================================

  @Post('google-merchant/bulk-sync')
  async bulkSyncToGoogleMerchant() {
    const result = await this.googleMerchantService.bulkSyncAllProducts();
    return {
      message: `Bulk sync selesai: ${result.success} berhasil, ${result.failed} gagal dari ${result.total} produk`,
      ...result,
    };
  }
}