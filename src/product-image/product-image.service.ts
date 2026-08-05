import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductImage } from './entities/product-image.entity';
import { Product } from '../product/entities/product.entity';

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

@Injectable()
export class ProductImageService {
  private readonly logger = new Logger(ProductImageService.name);

  constructor(
    @InjectRepository(ProductImage)
    private readonly repo: Repository<ProductImage>,

    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  private uploadBasePath = path.join(process.cwd(), 'uploads', 'products');
  private originalPath = path.join(this.uploadBasePath, 'original');
  private thumbPath = path.join(this.uploadBasePath, 'thumbnails');

  private ensureDirectories() {
    if (!fs.existsSync(this.originalPath)) {
      fs.mkdirSync(this.originalPath, { recursive: true });
    }

    if (!fs.existsSync(this.thumbPath)) {
      fs.mkdirSync(this.thumbPath, { recursive: true });
    }
  }

  private deleteFileIfExists(filePath?: string | null) {
    try {
      if (!filePath) return;

      const fullPath = path.join(process.cwd(), filePath);

      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (err) {
      this.logger.error("Failed deleting file:", filePath);
    }
  }

  private async saveImage(buffer: Buffer, fileName: string) {
    const originalFile = path.join(this.originalPath, fileName);
    const thumbFile = path.join(this.thumbPath, fileName);

    await sharp(buffer)
      .resize(2000, 2000, { fit: 'inside' })
      .jpeg({ quality: 90 })
      .toFile(originalFile);

    return {
      original: `/uploads/products/original/${fileName}`,
      thumbFile,
      thumb: `/uploads/products/thumbnails/${fileName}`,
    };
  }

  async create(productId: string, file: Express.Multer.File, variantId?: string, sortOrder?: number) {
    const product = await this.productRepo.findOne({
      where: { id: productId },
      relations: ['images'],
    });

    if (!product) throw new NotFoundException('Product not found');
    if (!file) throw new BadRequestException('File not found');

    this.ensureDirectories();

    const fileName = `${uuidv4()}.jpg`;
    const saved = await this.saveImage(file.buffer, fileName);

    this.logger.log(
      `📤 [UPLOAD GAMBAR] Product: ${productId}, Variant: ${variantId || '-'}, Sort: ${sortOrder ?? 'auto'}, File: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB) -> ${saved.original}`,
    );

    // 🔥 Ambil gambar sesuai konteks (per variant atau per produk tanpa variant)
    let contextImages: ProductImage[];
    if (variantId) {
      contextImages = await this.repo.find({
        where: { variant_id: variantId },
        order: { sort_order: 'ASC' },
      });
    } else {
      contextImages = (product.images || []).filter(img => !img.variant_id);
    }

    const isFirstForContext = contextImages.length === 0;

    let thumbnailUrl: string | null = null;

    const isMainImage = sortOrder !== undefined ? sortOrder === 0 : isFirstForContext;

    if (isMainImage) {
      await sharp(file.buffer)
        .resize(300, 300, { fit: 'inside' })
        .jpeg({ quality: 75 })
        .toFile(saved.thumbFile);
      thumbnailUrl = saved.thumb;
    }

    const image = this.repo.create();
    image.image_url = saved.original;
    image.thumbnail_url = thumbnailUrl;
    
    if (sortOrder !== undefined) {
      image.sort_order = sortOrder;
    } else {
      image.sort_order = contextImages.length > 0
        ? Math.max(...contextImages.map(i => i.sort_order)) + 1
        : 0;
    }
    image.product = product;
    image.variant_id = variantId || null;

    return this.repo.save(image);
  }

  async findAll() {
    return this.repo.find({
      relations: ['product'],
      order: { sort_order: 'ASC' },
    });
  }

  async findOne(id: string) {
    const image = await this.repo.findOne({
      where: { id },
      relations: ['product'],
    });

    if (!image) {
      throw new NotFoundException('Product image not found');
    }

    return image;
  }

  async update(id: string, file: Express.Multer.File) {
    const image = await this.repo.findOne({
      where: { id },
      relations: ['product', 'product.images'],
    });

    if (!image) throw new NotFoundException('Image not found');
    if (!file) throw new BadRequestException('File not found');

    this.ensureDirectories();

    // hapus file lama
    this.deleteFileIfExists(image.image_url);
    this.deleteFileIfExists(image.thumbnail_url);

    const fileName = `${uuidv4()}.jpg`;

    const saved = await this.saveImage(file.buffer, fileName);

    const isFirstImage =
      [...image.product.images]
        .sort((a, b) => a.sort_order - b.sort_order)[0]?.id === image.id;

    if (isFirstImage) {
      await sharp(file.buffer)
        .resize(300, 300, { fit: 'inside' })
        .jpeg({ quality: 75 })
        .toFile(saved.thumbFile);

      image.thumbnail_url = saved.thumb;
    } else {
      image.thumbnail_url = null;
    }

    image.image_url = saved.original;

    this.logger.log(
      `♻️ [UPDATE GAMBAR] Image ID: ${id}, File: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB) -> ${saved.original}`,
    );

    return this.repo.save(image);
  }

  async remove(id: string) {

    const image = await this.repo.findOne({
      where: { id },
      relations: ['product', 'product.images'],
    });

    if (!image) throw new NotFoundException('Image not found');

    this.deleteFileIfExists(image.image_url);
    this.deleteFileIfExists(image.thumbnail_url);

    this.logger.log(
      `🗑️ [HAPUS GAMBAR] Image ID: ${id}, Product: ${image.product?.id || '-'}, URL: ${image.image_url}`,
    );

    return this.repo.remove(image);
  }
}