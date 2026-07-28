import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { Product } from './entities/product.entity';
import { Category } from '../category/entities/category.entity'; 
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductImage } from '../product-image/entities/product-image.entity';
import { AdminProductController } from './admin-product.controller';
import { PublicProductController } from './public-product.controller';
import { Brand } from '../brand/entities/brand.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductView } from './entities/product-view.entity';
import { GoogleMerchantService } from './google-merchant.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, Category, ProductImage, Brand, ProductVariant, ProductView]) 
  ],
  controllers: [AdminProductController, PublicProductController],
  providers: [ProductService, GoogleMerchantService],
  exports: [ProductService],
})
export class ProductModule {}
