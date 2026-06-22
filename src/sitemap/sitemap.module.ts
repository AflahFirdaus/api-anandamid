import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../product/entities/product.entity';
import { SitemapController } from './sitemap.controller';
import { SitemapService } from './sitemap.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  controllers: [SitemapController],
  providers: [SitemapService],
})
export class SitemapModule {}