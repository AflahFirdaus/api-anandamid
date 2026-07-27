import { Injectable, NotFoundException, Logger } from '@nestjs/common';

import { CreateProductDto } from './dto/create.product.dto';
import { UpdateProductDto } from './dto/update.product.dto';
import { Product } from './entities/product.entity';
import { Category } from '../category/entities/category.entity';
import { Brand } from 'src/brand/entities/brand.entity';
import { ProductImage } from 'src/product-image/entities/product-image.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductView } from './entities/product-view.entity';
import { GoogleMerchantService } from './google-merchant.service';

import { Repository, Brackets, In } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import crypto from 'crypto';

@Injectable()
export class ProductService {
  private ensureDirectories() {
    if (!fs.existsSync(this.originalPath)) {
      fs.mkdirSync(this.originalPath, { recursive: true });
    }

    if (!fs.existsSync(this.thumbPath)) {
      fs.mkdirSync(this.thumbPath, { recursive: true });
    }
  }

  private deleteFileIfExists(filePath?: string | null) {
    if (!filePath) return;

    const cleanPath = filePath.replace(/^\/+/, '');

    const fullPath = path.join(process.cwd(), cleanPath);

    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch (err) {
        console.error('Failed delete:', fullPath);
      }
    } else {
      console.warn('File not found:', fullPath);
    }
  }

  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,

    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,

    @InjectRepository(Brand)
    private brandRepository: Repository<Brand>,

    @InjectRepository(ProductImage)
    private productImageRepository: Repository<ProductImage>,

    @InjectRepository(ProductVariant)
    private productVariantRepository: Repository<ProductVariant>,

    @InjectRepository(ProductView)
    private productViewRepository: Repository<ProductView>,

    private readonly googleMerchantService: GoogleMerchantService,
  ) {}

  private uploadBasePath = path.join(process.cwd(), 'uploads', 'products');
  private originalPath = path.join(this.uploadBasePath, 'original');
  private thumbPath = path.join(this.uploadBasePath, 'thumbnails');

  private async generateUniqueProductId(): Promise<string> {
    let productId: string;
    let exists: Product | null;

    do {
      const random = Math.floor(100000 + Math.random() * 900000);
      productId = `PRD-${random}`;

      exists = await this.productRepository.findOne({
        where: { product_id: productId },
      });
    } while (exists);

    return productId;
  }

  private parseDescription(text: string | null) {
    if (!text) {
      return {
        description_raw: '',
        specifications: [],
      };
    }

    const normalized = text.replace(/\r\n/g, '\n');

    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');

    return {
      description_raw: text,
      specifications: lines,
    };
  }

  private async downloadAndReplace(image: any, createThumb = false) {
    const fileName = path.basename(image.image_url || '');
    const originalFile = path.join(this.originalPath, fileName);
    const thumbFile = path.join(this.thumbPath, fileName);

    // CASE 1: Local File
    if (
      image.image_url?.startsWith('/uploads') &&
      fs.existsSync(originalFile)
    ) {
      if (createThumb) {
        if (!fs.existsSync(thumbFile)) {
          await sharp(originalFile)
            .resize(300, 300, { fit: 'inside' })
            .jpeg({ quality: 75 })
            .toFile(thumbFile);
        }
        image.thumbnail_url = `/uploads/products/thumbnails/${fileName}`;
      }
      // 🔥 FIX: Jangan null-kan thumbnail_url yang sudah ada untuk gambar non-utama
      // Biarkan nilai existing thumbnail_url tidak berubah
      return;
    }

    // CASE 2: external image
    if (!image.image_url?.startsWith('http')) {
      return;
    }

    this.ensureDirectories();

    try {
      const response = await axios.get(image.image_url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://www.tiktok.com/',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });

      if (!response.data || response.data.length < 100) {
        return;
      }

      const ext = '.jpg';

      const hash = crypto
        .createHash('md5')
        .update(image.image_url)
        .digest('hex');

      const fileName = `${hash}${ext}`;

      const originalFile = path.join(this.originalPath, fileName);
      const thumbFile = path.join(this.thumbPath, fileName);

      if (fs.existsSync(originalFile) && fs.existsSync(thumbFile)) {
        image.image_url = `/uploads/products/original/${fileName}`;
        image.thumbnail_url = `/uploads/products/thumbnails/${fileName}`;
        return;
      }

      await sharp(response.data).jpeg({ quality: 90 }).toFile(originalFile);

      if (createThumb) {
        await sharp(response.data)
          .resize(300, 300, { fit: 'inside' })
          .jpeg({ quality: 75 })
          .toFile(thumbFile);
      }

      image.image_url = `/uploads/products/original/${fileName}`;

      if (createThumb) {
        image.thumbnail_url = `/uploads/products/thumbnails/${fileName}`;
      } else {
        image.thumbnail_url = null;
      }
    } catch (err: any) {
      console.error('Download gagal:', image.image_url);
    }
  }

  async ensureImagesDownloaded(product: Product) {
    if (!product.images?.length) return;

    let updated = false;

    for (const img of product.images) {
      const before = img.thumbnail_url;
      const isMainImage = img.sort_order === 0;

      await this.downloadAndReplace(img, isMainImage);

      if (before !== img.thumbnail_url) {
        updated = true;
      }
    }

    if (updated) {
      await this.productRepository.save(product);
    }
  }

  async createProduct(dto: any) {
    const category = await this.categoryRepository.findOne({
      where: { id: dto.category_id },
    });
    if (!category) throw new NotFoundException('Category not found');

    let brand: Brand | null = null;
    if (dto.brand_id) {
      brand = await this.brandRepository.findOne({
        where: { id: dto.brand_id },
      });
      if (!brand) throw new NotFoundException('Brand not found');
    }

    const duplicateName = dto.name
      ? await this.productRepository.find({ where: { name: dto.name } })
      : [];

    const productId = await this.generateUniqueProductId();

    let finalVariants: any[] = [];

    if (dto.has_variants && dto.variants?.length > 0) {
      finalVariants = dto.variants.map((v: any) => ({
        variant_name: v.variant_name,
        sku_seller: v.sku_seller || null,
        price_normal: v.price_normal || 0,
        price_discount: v.price_discount || 0,
        stock: v.stock || 0,
        weight: v.weight || 0,
        length: v.length || 0,
        width: v.width || 0,
        height: v.height || 0,
      }));
    } else {
      finalVariants = [
        {
          variant_name: 'Default',
          sku_seller: dto.sku_seller || null,
          price_normal: dto.price_normal || 0,
          price_discount: dto.price_discount || 0,
          stock: dto.stock || 0,
          weight: dto.weight || 0,
          length: dto.length || 0,
          width: dto.width || 0,
          height: dto.height || 0,
        },
      ];
    }

    const product = this.productRepository.create({
      ...dto,
      product_id: productId,
      category,
      brand,
      variants: finalVariants,
    });

    const savedProduct = await this.productRepository.save(product);

    // Fire-and-forget: sync ke Google Merchant Center tanpa memblokir response
    this.googleMerchantService
      .syncProduct(savedProduct)
      .catch((err) =>
        console.error('[GoogleMerchant] Gagal sync produk baru:', err.message),
      );

    return {
      product: savedProduct,
      duplicate_warning:
        duplicateName.length > 0
          ? {
              /* ... metadata duplicate ... */
            }
          : null,
    };
  }

  async findAllProduct(query: any) {
    const {
      page = '1',
      limit = '20',
      no_limit,
      search,
      category,
      brand,
      sort,
      is_popular,
      is_active,
      is_promo,
      min_price,
      max_price,
      only_duplicate,
      no_category,
      category_ids,
      grouping,
      socket_type,
      ram_type,
    } = query;

    const safeLimit = Number(limit) > 100 ? 100 : Number(limit);
    const safePage = Number(page) < 1 ? 1 : Number(page);

    const duplicateTotalRaw = await this.productRepository.query(`
      SELECT COUNT(DISTINCT p.id)
      FROM products p
      WHERE EXISTS (
        SELECT 1
        FROM product_variants pv
        WHERE pv.product_id = p.id
        AND pv.sku_seller IS NOT NULL
        AND pv.sku_seller <> ''
        AND pv.sku_seller <> 'NaN'
        AND EXISTS (
          SELECT 1
          FROM product_variants pv2
          WHERE pv2.sku_seller = pv.sku_seller
          AND pv2.product_id != pv.product_id
          LIMIT 1
        )
      )
    `);

    const duplicateTotal = Number(duplicateTotalRaw[0]?.count || 0);

    const qb = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('category.grouping', 'grouping')
      .leftJoinAndSelect('product.brand', 'brand')
      .leftJoinAndSelect('product.variants', 'variant'); // 🔥 JOIN KE VARIANT

    qb.leftJoin('product.images', 'thumbnail', 'thumbnail.sort_order = 0');

    qb.addSelect(['thumbnail.image_url', 'thumbnail.thumbnail_url']);

    qb.addOrderBy('thumbnail.sort_order', 'ASC');

    // ======================
    // DEFAULT LANDING FILTER
    // ======================
    if (is_active !== undefined) {
      const isActiveParsed = is_active === 'true';

      qb.andWhere('product.is_active = :is_active', {
        is_active: isActiveParsed,
      });
    }

    // ======================
    // SEARCH
    // ======================
    if (search) {
      qb.andWhere('LOWER(product.name) LIKE LOWER(:search)', {
        search: `%${search}%`,
      });

      await this.productRepository
        .createQueryBuilder()
        .update(Product)
        .set({
          search_count: () => 'search_count + 1',
        })
        .where('LOWER(name) LIKE LOWER(:search)', {
          search: `%${search}%`,
        })
        .execute();
    }

    // ======================
    // BRAND FILTER
    // ======================
    if (brand) {
      const brandIds = brand.split(',');

      qb.andWhere('brand.id IN (:...brandIds)', {
        brandIds,
      });
    }

    // =================
    // HARDWARE FILTER
    // =================
    if (socket_type) {
      const sockets = socket_type.split(',');
      qb.andWhere('product.socket_type IN (:...sockets)', { sockets });
    }

    if (ram_type) {
      const ramTypes = ram_type.split(',');
      qb.andWhere('product.ram_type IN (:...ramTypes)', { ramTypes });
    }

    // ======================
    // CATEGORY FILTER
    // ======================
    if (no_category === 'true') {
      qb.andWhere('product.category_id IS NULL');
    } else if (category) {
      qb.andWhere(
        new Brackets((qb2) => {
          qb2
            .where('LOWER(category.name) LIKE LOWER(:category)', {
              category: `%${category}%`,
            })
            .orWhere('category.code = :categoryExact', {
              categoryExact: category,
            });
        }),
      );
    }

    // ======================
    // GROUPING FILTER
    // ======================
    if (grouping) {
      const categories = await this.categoryRepository.find({
        where: {
          grouping: {
            name: grouping,
          },
        },
        select: ['id'],
      });

      const ids = categories.map((c) => c.id);

      if (!ids.length) {
        qb.andWhere('1=0');
      } else {
        qb.andWhere('category.id IN (:...ids)', { ids });
      }
    }

    // ======================
    // CATEGORY IDS FILTER
    // ======================
    if (category_ids) {
      const ids = category_ids.split(',');

      qb.andWhere('category.id IN (:...ids)', {
        ids,
      });
    }

    // ======================
    // POPULAR FILTER
    // ======================
    if (is_popular !== undefined) {
      const isPopularParsed = is_popular === 'true';

      qb.andWhere('product.is_popular = :is_popular', {
        is_popular: isPopularParsed,
      });
    }

    // ======================
    // PROMO / DISCOUNT FILTER
    // ======================
    if (is_promo === 'true') {
      // 🔥 Filter by variant
      qb.andWhere('variant.price_discount > 0');
    }

    // ======================
    // PRICE RANGE FILTER
    // ======================
    if (min_price !== undefined || max_price !== undefined) {
      // 🔥 Filter by variant
      qb.andWhere(
        `
        (variant.price_normal - COALESCE(variant.price_discount, 0))
        BETWEEN COALESCE(:min_price, 0)
        AND COALESCE(:max_price, 999999999)
        `,
        {
          min_price: min_price ? Number(min_price) : null,
          max_price: max_price ? Number(max_price) : null,
        },
      );
    }

    const seed = Math.floor(Date.now() / 10000);

    // ======================
    // SORTING
    // ======================
    // 🔥 Pindah ke variant
    qb.addSelect(
      'variant.price_normal - COALESCE(variant.price_discount, 0)',
      'final_price_sort',
    );

    // 🔥 Cek duplicate dari tabel product_variants
    // Hanya flag sebagai duplicate jika SKU yang sama ada di PRODUK yang berbeda
    // (bukan dalam variant produk yang sama)
    qb.addSelect(
      `
      CASE 
        WHEN variant.sku_seller IS NOT NULL
        AND variant.sku_seller <> ''
        AND variant.sku_seller <> 'NaN'
        AND EXISTS (
          SELECT 1
          FROM product_variants pv2
          WHERE pv2.sku_seller = variant.sku_seller
          AND pv2.product_id != product.id
          LIMIT 1
        )
        THEN true
        ELSE false
      END
    `,
      'is_duplicate_flag',
    );

    // 🔥 Sortir stock pindah ke variant
    qb.addSelect(
      `CASE WHEN variant.stock IS NULL OR variant.stock <= 0 THEN 1 ELSE 0 END`,
      'stock_order',
    );

    qb.addSelect(`MOD(abs(hashtext(product.id::text)), :seed)`, 'random_order');

    qb.addSelect(
      `
      (
        COALESCE(product.view_count, 0) * 0.7 +
        COALESCE(product.search_count, 0) * 0.3
      )
    `,
      'recommend_score',
    );

    qb.setParameter('seed', seed);

    if (only_duplicate === 'true') {
      // 🔥 Filter duplicate cek dari variant
      // Hanya flag sebagai duplicate jika SKU yang sama ada di PRODUK yang berbeda
      qb.andWhere(`
        variant.sku_seller IS NOT NULL
        AND variant.sku_seller <> ''
        AND variant.sku_seller <> 'NaN'
        AND EXISTS (
          SELECT 1
          FROM product_variants pv2
          WHERE pv2.sku_seller = variant.sku_seller
          AND pv2.product_id != product.id
          LIMIT 1
        )
      `);

      qb.orderBy('stock_order', 'ASC')
        .addOrderBy('variant.sku_seller', 'ASC')
        .addOrderBy('product.created_at', 'DESC');
    } else {
      qb.orderBy('stock_order', 'ASC');

      if (sort === 'popular') {
        qb.addOrderBy('product.is_popular', 'DESC')
          .addOrderBy('variant.stock', 'DESC')
          .addOrderBy('product.created_at', 'DESC');
      } else if (sort === 'price_asc') {
        qb.addOrderBy('final_price_sort', 'ASC')
          .addOrderBy('variant.stock', 'DESC')
          .addOrderBy('product.created_at', 'DESC');
      } else if (sort === 'price_desc') {
        qb.addOrderBy('final_price_sort', 'DESC')
          .addOrderBy('variant.stock', 'DESC')
          .addOrderBy('product.created_at', 'DESC');
      } else if (sort === 'newest') {
        qb.addOrderBy('product.updated_at', 'DESC').addOrderBy(
          'product.created_at',
          'DESC',
        );
      } else if (sort === 'recommend') {
        qb.orderBy('stock_order', 'ASC')
          .addOrderBy('random_order', 'ASC')
          .addOrderBy('recommend_score', 'DESC');
      } else {
        qb.orderBy('stock_order', 'ASC').addOrderBy('random_order', 'ASC');
      }
    }

    const countQb = qb.clone();

    if (no_limit !== 'true') {
      qb.skip((safePage - 1) * safeLimit).take(safeLimit);
    }

    const { raw, entities } = await qb.getRawAndEntities();
    const total = await countQb.getCount();

    const data = entities.map((product) => {
      const parsed = this.parseDescription(product.description);
      const rawRow = raw.find((r) => r.product_id === product.id);

      // 🔥 Ambil dari variant default
      const defaultVariant =
        product.variants && product.variants.length > 0
          ? product.variants[0]
          : null;

      const finalPrice =
        Number(defaultVariant?.price_normal || 0) -
        Number(defaultVariant?.price_discount || 0);

      const isPromo = Number(defaultVariant?.price_discount || 0) > 0;

      return {
        ...product,

        final_price: finalPrice,
        is_promo: isPromo,

        description_raw: parsed.description_raw,
        specifications: parsed.specifications,

        is_duplicate:
          rawRow?.is_duplicate_flag === true ||
          rawRow?.is_duplicate_flag === 'true',

        duplicate_group: defaultVariant?.sku_seller || null,
      };
    });

    return {
      data,
      total,
      duplicateTotal,
      page: safePage,
      last_page: no_limit === 'true' ? 1 : Math.ceil(total / safeLimit),
    };
  }

  private async trackProductView(id: string): Promise<void> {
    await this.productRepository.increment({ id }, 'view_count', 1);

    const today = new Date().toISOString().split('T')[0];
    try {
      await this.productViewRepository.query(
        `
        INSERT INTO product_views (product_id, view_date, count)
        VALUES ($1, $2, 1)
        ON CONFLICT (product_id, view_date) 
        DO UPDATE SET count = product_views.count + 1
      `,
        [id, today],
      );
    } catch (err) {
      console.error('Gagal update statistik harian:', err);
    }
  }

  async findOneByParams(id: string, track = false): Promise<any> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['category', 'images', 'brand', 'variants', 'variants.images'],
      order: { images: { sort_order: 'ASC' } },
    });

    if (!product) throw new NotFoundException('Product not found');

    // Tracking hanya kalau diminta (user publik, bukan admin/internal)
    if (track) {
      await this.trackProductView(id);
    }

    await this.ensureImagesDownloaded(product);

    const parsed = this.parseDescription(product.description);
    return { ...product, ...parsed };
  }

  async getProductViewStats(productId: string) {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const stats = await this.productViewRepository
      .createQueryBuilder('pv')
      .where('pv.product_id = :id', { id: productId })
      .andWhere('pv.view_date >= :from', {
        from: weekAgo.toISOString().split('T')[0],
      })
      .orderBy('pv.view_date', 'ASC')
      .getMany();

    return {
      total_lifetime:
        (
          await this.productRepository.findOne({
            where: { id: productId },
            select: ['view_count'],
          })
        )?.view_count || 0,
      weekly_chart: stats.map((s) => ({ date: s.view_date, count: s.count })),
    };
  }

  async getTopViewedProducts(
    period: 'today' | 'week' | 'month' | 'custom' = 'week',
    limit = 10,
    from?: string,
    to?: string,
  ) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const qb = this.productViewRepository
      .createQueryBuilder('pv')
      .select('pv.product_id', 'id')
      .addSelect('SUM(pv.count)', 'total_views')
      .addSelect('product.name', 'name')
      .leftJoin('pv.product', 'product')
      .groupBy('pv.product_id')
      .addGroupBy('product.name')
      .orderBy('total_views', 'DESC')
      .limit(limit);

    if (period === 'custom' && from && to) {
      qb.where('pv.view_date BETWEEN :from AND :to', { from, to });
    } else if (period === 'today') {
      qb.where('pv.view_date = :today', { today: todayStr });
    } else if (period === 'week') {
      const fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 7);
      qb.where('pv.view_date BETWEEN :from AND :to', {
        from: fromDate.toISOString().split('T')[0],
        to: todayStr,
      });
    } else if (period === 'month') {
      const fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 30);
      qb.where('pv.view_date BETWEEN :from AND :to', {
        from: fromDate.toISOString().split('T')[0],
        to: todayStr,
      });
    }

    const results = await qb.getRawMany();

    return results.map((r) => ({
      ...r,
      total_views: Number(r.total_views),
    }));
  }

  async updateProductByParams(id: string, dto: any): Promise<any> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['category', 'brand', 'images', 'variants', 'variants.images'],
      order: { images: { sort_order: 'ASC' } },
    });

    if (!product) throw new NotFoundException('Product not found');

    const {
      images,
      variants,
      price_normal,
      price_discount,
      stock,
      sku_seller,
      has_variants,
      ...productData
    } = dto;

    Object.assign(product, productData);

    if (dto.brand_id !== undefined) {
      product.brand = dto.brand_id
        ? await this.brandRepository.findOneBy({ id: dto.brand_id })
        : null;
    }
    if (dto.category_id) {
      product.category = await this.categoryRepository.findOneBy({
        id: dto.category_id,
      });
    }

    // ============================================================
    // VARIANT SYNC — hapus yang tidak ada di payload
    // ============================================================
    const existingVariantIds = product.variants.map((v) => v.id);

    if (has_variants === true && Array.isArray(variants)) {
      const incomingIds = variants.filter((v) => v.id).map((v) => v.id);

      // Hapus variasi lama yang tidak ada di payload baru
      const toDelete = existingVariantIds.filter(
        (eid) => !incomingIds.includes(eid),
      );
      if (toDelete.length > 0) {
        await this.productVariantRepository.delete(toDelete); // ← tambah inject repo ini
      }

      product.variants = variants.map((v: any) => ({
        id: v.id || undefined,
        variant_name: v.variant_name,
        price_normal: v.price_normal,
        price_discount: v.price_discount,
        stock: v.stock,
        sku_seller: v.sku_seller || null,
        weight: v.weight || 0,
        length: v.length || 0,
        width: v.width || 0,
        height: v.height || 0,
      })) as any[];
    } else {
      // Mode simple product — pastikan hanya ada 1 variant Default
      const toDelete = existingVariantIds.slice(1);
      if (toDelete.length > 0) {
        await this.productVariantRepository.delete(toDelete);
      }

      let defVariant =
        product.variants.find((v) => v.variant_name === 'Default') ||
        product.variants[0];
      if (!defVariant) defVariant = { variant_name: 'Default' } as any;

      defVariant.variant_name = 'Default';
      defVariant.price_normal = price_normal ?? 0;
      defVariant.price_discount = price_discount ?? 0;
      defVariant.stock = stock ?? 0;
      defVariant.sku_seller = sku_seller || null;
      defVariant.weight = dto.weight || 0;
      defVariant.length = dto.length || 0;
      defVariant.width = dto.width || 0;
      defVariant.height = dto.height || 0;

      product.variants = [defVariant];
    }

    await this.productRepository.save(product);

    // Update sort_order gambar
    if (images && Array.isArray(images)) {
      for (const img of images) {
        if (img.id) {
          await this.productImageRepository.update(img.id, {
            sort_order: img.sort_order,
            variant_id: img.variant_id || null,
          });
        }
      }
    }

    const updatedProduct = await this.findOneByParams(id, false);

    // Fire-and-forget: sync ke Google Merchant Center
    this.googleMerchantService
      .syncProduct(updatedProduct)
      .catch((err) =>
        console.error(
          '[GoogleMerchant] Gagal sync produk update:',
          err.message,
        ),
      );

    return updatedProduct;
  }

  async deleteProductByParams(id: string): Promise<void> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['images'],
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    for (const img of product.images) {
      this.deleteFileIfExists(img.image_url);
      this.deleteFileIfExists(img.thumbnail_url);
    }

    // Hapus dari Google Merchant Center sebelum delete dari DB
    this.googleMerchantService
      .deleteProduct(id)
      .catch((err) =>
        console.error('[GoogleMerchant] Gagal hapus produk:', err.message),
      );

    await this.productRepository.remove(product);
  }

  async findActiveProducts(query: any) {
    // Security: block no_limit on public endpoint to prevent catalog dumping
    const { no_limit, ...safeQuery } = query;
    return this.findAllProduct({
      ...safeQuery,
      is_active: 'true',
    });
  }

  async bulkDelete(ids: string[]): Promise<void> {
    if (!ids.length) return;

    const products = await this.productRepository.find({
      where: { id: In(ids) },
      relations: ['images'],
    });

    for (const product of products) {
      for (const img of product.images) {
        this.deleteFileIfExists(img.image_url);
        this.deleteFileIfExists(img.thumbnail_url);
      }
    }

    // Hapus inventory histories terlebih dahulu untuk menghindari FK constraint violation
    if (products.length > 0) {
      await this.productRepository.manager.query(
        `DELETE FROM inventory_histories WHERE product_id = ANY($1)`,
        [ids],
      );
    }

    await this.productRepository.delete(ids);
  }

  async bulkDeleteOldDuplicates(): Promise<{ deletedCount: number }> {
    // Cari semua variant yang memiliki sku_seller duplikat
    const duplicateSkus = await this.productVariantRepository
      .createQueryBuilder('variant')
      .select('variant.sku_seller')
      .where('variant.sku_seller IS NOT NULL')
      .andWhere("variant.sku_seller != ''")
      .andWhere("variant.sku_seller != 'NaN'")
      .groupBy('variant.sku_seller')
      .having('COUNT(*) > 1')
      .getRawMany();

    if (!duplicateSkus.length) {
      return { deletedCount: 0 };
    }

    const skus = duplicateSkus.map((r) => r.variant_sku_seller);

    // Untuk setiap SKU, ambil semua produk yang memiliki variant dengan SKU tersebut
    // Urutkan berdasarkan updated_at DESC, simpan yang terbaru, hapus sisanya
    const allIdsToDelete: string[] = [];

    for (const sku of skus) {
      const productsWithSku = await this.productRepository
        .createQueryBuilder('product')
        .innerJoin('product.variants', 'variant')
        .where('variant.sku_seller = :sku', { sku })
        .orderBy('product.updated_at', 'DESC')
        .addOrderBy('product.created_at', 'DESC')
        .getMany();

      // Simpan produk pertama (paling baru), hapus sisanya
      const idsToDelete = productsWithSku.slice(1).map((p) => p.id);
      allIdsToDelete.push(...idsToDelete);
    }

    if (allIdsToDelete.length === 0) {
      return { deletedCount: 0 };
    }

    await this.bulkDelete(allIdsToDelete);

    return { deletedCount: allIdsToDelete.length };
  }

  async processSingleImage(imageUrl: string, sortOrder: number = 0) {
    if (!imageUrl) return null;

    const image: any = {
      image_url: imageUrl,
      sort_order: sortOrder,
    };

    await this.downloadAndReplace(image, sortOrder === 0);

    return {
      image_url: image.image_url,
      thumbnail_url: image.thumbnail_url,
    };
  }

  async getRecommendations(productId: string, limit = 10) {
    const currentProduct = await this.productRepository.findOne({
      where: { id: productId },
      relations: ['category'],
    });

    if (!currentProduct) {
      throw new NotFoundException('Product not found');
    }

    const seed = Math.floor(Date.now() / 10000);

    const qb = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.brand', 'brand')
      .leftJoinAndSelect('product.variants', 'variant'); // 🔥 Supaya harganya tetap terbaca

    qb.where('product.id != :id', { id: productId });

    qb.addSelect(
      `
      CASE 
        WHEN product.category_id = :catId THEN 1
        ELSE 0
      END
    `,
      'same_category',
    );

    qb.setParameter('catId', currentProduct.category?.id || null);

    qb.addSelect(
      `
      CASE 
        WHEN product.brand_id = :brandId THEN 1
        ELSE 0
      END
    `,
      'same_brand',
    );

    qb.setParameter('brandId', currentProduct.brand?.id || null);

    qb.addSelect(
      `
      (
        COALESCE(product.view_count, 0) * 0.7 +
        COALESCE(product.search_count, 0) * 0.3
      )
    `,
      'recommend_score',
    );

    qb.addSelect(`MOD(abs(hashtext(product.id::text)), :seed)`, 'random_order');

    qb.addSelect(
      `
      (
        (CASE WHEN product.brand_id = :brandId THEN 1 ELSE 0 END) * 0.5 +
        (CASE WHEN product.category_id = :catId THEN 1 ELSE 0 END) * 0.3 +
        (CASE WHEN LOWER(product.name) LIKE LOWER(:name) THEN 1 ELSE 0 END) * 0.1 +
        (
          COALESCE(product.view_count, 0) * 0.7 +
          COALESCE(product.search_count, 0) * 0.3
        ) * 0.2 +
        (RANDOM() * 0.1)
      )
    `,
      'final_score',
    );

    qb.orderBy('final_score', 'DESC');
    qb.setParameter('seed', seed);
    qb.take(limit);

    const { entities } = await qb.getRawAndEntities();

    return entities;
  }

  async removeBrand(productId: string) {
    const product = await this.productRepository.findOne({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    product.brand = null;

    await this.productRepository.save(product);

    return { message: 'Brand removed from product' };
  }

  async getCompatibilityBuilder(query: {
    processor_id?: string;
    motherboard_id?: string;
    ram_id?: string;
  }) {
    let requiredSocket: string | null = null;
    let requiredRamType: string | null = null;

    const [cpu, mobo, ram] = await Promise.all([
      query.processor_id
        ? this.productRepository.findOne({ where: { id: query.processor_id } })
        : null,
      query.motherboard_id
        ? this.productRepository.findOne({
            where: { id: query.motherboard_id },
          })
        : null,
      query.ram_id
        ? this.productRepository.findOne({ where: { id: query.ram_id } })
        : null,
    ]);

    const normalize = (val?: string | null) =>
      val ? val.toLowerCase().trim() : null;

    const cpuSocket = normalize(cpu?.socket_type);
    const moboSocket = normalize(mobo?.socket_type);
    const moboRam = normalize(mobo?.ram_type);
    const ramType = normalize(ram?.ram_type);

    if (cpuSocket) requiredSocket = cpuSocket;
    if (moboSocket) requiredSocket = moboSocket;

    if (ramType) requiredRamType = ramType;
    if (moboRam) requiredRamType = moboRam;

    if (cpuSocket && moboSocket && cpuSocket !== moboSocket) {
      return {
        active_constraints: {
          socket: 'Tidak kompatibel',
          ram_type: requiredRamType || 'Belum ditentukan',
        },
        available_processors: [],
        available_motherboards: [],
        available_rams: [],
      };
    }

    const cpuQuery = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.variants', 'variant')
      .leftJoinAndSelect('product.images', 'images')
      .where('LOWER(category.name) LIKE :cat', { cat: '%processor%' });

    if (requiredSocket) {
      cpuQuery.andWhere('LOWER(product.socket_type) = :socket', {
        socket: requiredSocket,
      });
    }

    const processors = await cpuQuery.getMany();

    const moboQuery = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.variants', 'variant')
      .leftJoinAndSelect('product.images', 'images')
      .where('LOWER(category.name) LIKE :cat', { cat: '%motherboard%' });

    if (requiredSocket) {
      moboQuery.andWhere('LOWER(product.socket_type) = :socket', {
        socket: requiredSocket,
      });
    }

    if (requiredRamType) {
      moboQuery.andWhere('LOWER(product.ram_type) = :ram', {
        ram: requiredRamType,
      });
    }

    const motherboards = await moboQuery.getMany();

    const ramQuery = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.variants', 'variant')
      .leftJoinAndSelect('product.images', 'images')
      .where('LOWER(category.name) LIKE :cat', { cat: '%ram%' });

    if (requiredRamType) {
      ramQuery.andWhere('LOWER(product.ram_type) = :ram', {
        ram: requiredRamType,
      });
    }

    const rams = await ramQuery.getMany();

    const mapWithPrice = (products: Product[]) =>
      products.map((p) => {
        const variant = p.variants?.[0];
        return {
          ...p,
          final_price:
            Number(variant?.price_normal || 0) -
            Number(variant?.price_discount || 0),
        };
      });

    return {
      active_constraints: {
        socket: requiredSocket || '-',
        ram_type: requiredRamType || '-',
      },
      available_processors: mapWithPrice(processors),
      available_motherboards: mapWithPrice(motherboards),
      available_rams: mapWithPrice(rams),
    };
  }

  async deletePhysicalImage(filePath?: string | null) {
    if (!filePath) return;

    const fullPath = path.join(process.cwd(), filePath);

    if (fs.existsSync(fullPath)) {
      try {
        await fs.promises.unlink(fullPath);
      } catch (err) {
        console.error('Failed delete file:', fullPath);
      }
    }
  }

  async getHardwareTypes() {
    // Ambil socket unik
    const socketsRaw = await this.productRepository
      .createQueryBuilder('product')
      .select('DISTINCT product.socket_type', 'socket_type')
      .where('product.socket_type IS NOT NULL')
      .andWhere("product.socket_type != ''")
      .getRawMany();

    // Ambil ram unik
    const ramsRaw = await this.productRepository
      .createQueryBuilder('product')
      .select('DISTINCT product.ram_type', 'ram_type')
      .where('product.ram_type IS NOT NULL')
      .andWhere("product.ram_type != ''")
      .getRawMany();

    return {
      sockets: socketsRaw.map((s) => s.socket_type),
      rams: ramsRaw.map((r) => r.ram_type),
    };
  }

  async deleteProductImage(imageId: string): Promise<void> {
    const image = await this.productImageRepository.findOne({
      where: { id: imageId },
      relations: ['product'],
    });

    if (!image) {
      throw new NotFoundException('Image not found');
    }

    const productId = image.product.id;

    this.deleteFileIfExists(image.image_url);
    this.deleteFileIfExists(image.thumbnail_url);

    await this.productImageRepository.remove(image);

    const remainingImages = await this.productImageRepository.find({
      where: { product: { id: productId } },
      order: { sort_order: 'ASC' },
    });

    if (remainingImages.length > 0) {
      let hasChanges = false;

      for (let i = 0; i < remainingImages.length; i++) {
        if (remainingImages[i].sort_order !== i) {
          remainingImages[i].sort_order = i;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await this.productImageRepository.save(remainingImages);
      }
    }
  }
}
