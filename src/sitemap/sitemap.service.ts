import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../product/entities/product.entity';

@Injectable()
export class SitemapService {
  private readonly logger = new Logger(SitemapService.name);
  private readonly FRONTEND_URL = 'https://anandam.id';

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  /**
   * Generate XML sitemap dengan static URLs + dynamic product URLs.
   * Menggunakan chunking untuk menghindari memory overload.
   */
  async generateSitemapXml(): Promise<string> {
    const parts: string[] = [];

    // XML Declaration
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    // ==========================================
    // 1. STATIC URLs (priority tinggi)
    // ==========================================
    const staticUrls = [
      { loc: `${this.FRONTEND_URL}/`, changefreq: 'daily', priority: '1.0' },
      { loc: `${this.FRONTEND_URL}/company-profile`, changefreq: 'monthly', priority: '0.7' },
      { loc: `${this.FRONTEND_URL}/price-list`, changefreq: 'weekly', priority: '0.8' },
      { loc: `${this.FRONTEND_URL}/contact`, changefreq: 'monthly', priority: '0.6' },
    ];

    for (const url of staticUrls) {
      parts.push('  <url>');
        parts.push(`    <loc>${url.loc}</loc>`);
      parts.push(`    <changefreq>${url.changefreq}</changefreq>`);
      parts.push(`    <priority>${url.priority}</priority>`);
      parts.push('  </url>');
    }

    // ==========================================
    // 2. DYNAMIC PRODUCT URLs (chunk-based)
    // ==========================================
    const CHUNK_SIZE = 500;
    let offset = 0;
    let totalProducts = 0;
    let hasMore = true;

    while (hasMore) {
      const products = await this.productRepository
        .createQueryBuilder('product')
        .select(['product.id', 'product.updated_at'])
        .innerJoin('product.variants', 'variant')
        .where('product.is_active = :isActive', { isActive: true })
        .andWhere('variant.stock > 0')
        .groupBy('product.id')
        .orderBy('product.id', 'ASC')
        .offset(offset)
        .limit(CHUNK_SIZE)
        .getMany();

      if (products.length === 0) {
        hasMore = false;
        break;
      }

      for (const product of products) {
        const lastmod = product.updated_at.toISOString();
        parts.push('  <url>');
        parts.push(`    <loc>${this.FRONTEND_URL}/products/${product.id}</loc>`);
        parts.push(`    <lastmod>${lastmod}</lastmod>`);
        parts.push('    <changefreq>weekly</changefreq>');
        parts.push('    <priority>0.8</priority>');
        parts.push('  </url>');
      }

      offset += products.length;
      totalProducts = offset;
      this.logger.log(`Sitemap: processed ${offset} products...`);

      if (products.length < CHUNK_SIZE) {
        hasMore = false;
      }
    }

    parts.push('</urlset>');

    const xml = parts.join('\n');
    this.logger.log(`Sitemap generated successfully with ${totalProducts} products`);
    return xml;
  }
}