import { Injectable, OnModuleInit } from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';

@Injectable()
export class GoogleMerchantService implements OnModuleInit {
  private shoppingContent: any;
  private merchantId: string;
  private isEnabled: boolean = false;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
  ) {
    this.merchantId = this.configService.get<string>('GOOGLE_MERCHANT_ID') || '';
  }

  onModuleInit() {
    const rawJson = this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_JSON');

    // Jika env belum dikonfigurasi, service dimatikan (tidak error)
    if (!rawJson || !this.merchantId) {
      console.warn('[GoogleMerchant] Service dinonaktifkan — GOOGLE_SERVICE_ACCOUNT_JSON atau GOOGLE_MERCHANT_ID belum diset di .env');
      return;
    }

    try {
      const credentials = JSON.parse(rawJson);
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/content'],
      });

      this.shoppingContent = google.content({ version: 'v2.1', auth });
      this.isEnabled = true;
    } catch (err) {
      console.error('[GoogleMerchant] Gagal parse credentials JSON:', err.message);
    }
  }

  /**
   * Mengonversi produk Anandam ke format Google Merchant
   */
  private transformToGoogleProduct(product: any) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'https://anandam.id';
    const apiBase = this.configService.get<string>('API_BASE_URL') || 'https://api-marketplace.anandamcomputer.com';

    // Ambil gambar utama (sort_order = 0 atau gambar pertama)
    const mainImage = product.images?.find((img: any) => img.sort_order === 0) || product.images?.[0];
    const imageUrl = mainImage?.image_url
      ? mainImage.image_url.startsWith('http')
        ? mainImage.image_url
        : `${apiBase}${mainImage.image_url}`
      : `${apiBase}${product.thumbnail || ''}`;

    // Ambil data harga dari variant pertama/default
    const defaultVariant = product.variants?.[0];
    const priceNormal = Number(defaultVariant?.price_normal || product.price_normal || 0);
    const priceDiscount = Number(defaultVariant?.price_discount || product.price_discount || 0);
    const finalPrice = priceDiscount > 0 ? priceNormal - priceDiscount : priceNormal;
    const totalStock = product.variants?.reduce((sum: number, v: any) => sum + (v.stock || 0), 0) || product.stock || 0;

    // Slugify sederhana untuk URL produk
    const slug = product.name
      ?.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim();

    return {
      offerId: product.id,
      title: product.name?.substring(0, 150), // Maks 150 karakter
      description: (product.description || product.name || '').substring(0, 5000),
      link: `${frontendUrl}/products/${slug}--${product.id}`,
      imageLink: imageUrl,
      contentLanguage: 'id',
      targetCountry: 'ID',
      feedLabel: 'ID',
      channel: 'online',
      availability: totalStock > 0 ? 'in stock' : 'out of stock',
      condition: 'new',
      brand: product.brand?.name || 'Anandam Computer',
      price: {
        value: finalPrice.toString(),
        currency: 'IDR',
      },
      ...(priceDiscount > 0 && {
        salePrice: {
          value: finalPrice.toString(),
          currency: 'IDR',
        },
      }),
    };
  }

  /**
   * Sync satu produk ke Google Merchant Center (insert/update)
   */
  async syncProduct(product: any): Promise<any> {
    if (!this.isEnabled) return null;

    try {
      const googleProduct = this.transformToGoogleProduct(product);

      const response = await this.shoppingContent.products.insert({
        merchantId: this.merchantId,
        requestBody: googleProduct,
      });

      return response.data;
    } catch (error) {
      console.error('[GoogleMerchant] Sync error:', error.response?.data?.error?.message || error.message);
      throw error;
    }
  }

  /**
   * Hapus produk dari Google Merchant Center
   */
  async deleteProduct(productId: string): Promise<void> {
    if (!this.isEnabled) return;

    try {
      await this.shoppingContent.products.delete({
        merchantId: this.merchantId,
        productId: `online:id:ID:${productId}`,
      });
    } catch (error) {
      // Tidak lempar error agar proses delete DB tetap jalan
      console.error('[GoogleMerchant] Delete error:', error.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Bulk sync semua produk aktif ke Google Merchant Center
   * Dijalankan secara manual oleh admin via endpoint khusus
   */
  async bulkSyncAllProducts(): Promise<{ success: number; failed: number; total: number }> {
    if (!this.isEnabled) {
      return { success: 0, failed: 0, total: 0 };
    }

    const products = await this.productRepository.find({
      where: { is_active: true },
      relations: ['category', 'brand', 'images', 'variants'],
      order: { created_at: 'DESC' },
    });

    let success = 0;
    let failed = 0;

    // Proses per batch 10 produk agar tidak membanjiri API
    const BATCH_SIZE = 10;
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (product) => {
          try {
            await this.syncProduct(product);
            success++;
          } catch {
            failed++;
          }
        })
      );

      // Delay kecil antar batch agar tidak kena rate limit
      if (i + BATCH_SIZE < products.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return { success, failed, total: products.length };
  }
}
