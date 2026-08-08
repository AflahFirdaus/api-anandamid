import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ProductImageService } from './product-image.service';
import { CreateProductImageDto } from './dto/create-product-image.dto';
import { UpdateProductImageDto } from './dto/update-product-image.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';
import { BadRequestException } from '@nestjs/common';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

// 🔒 Filter + limit ukuran upload gambar produk.
// File diproses ulang oleh sharp → selalu jadi .jpg, aman dari stored XSS.
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const productImageUpload = {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req: any, file: Express.Multer.File, cb: (e: any, ok: boolean) => void) => {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Hanya file gambar (JPG, PNG, WebP, GIF) yang diizinkan.'), false);
    }
  },
};

@Controller('product-images')
export class ProductImageController {
  constructor(private readonly productImageService: ProductImageService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', productImageUpload))
  create(
    @UploadedFile() file: Express.Multer.File,
    @Body('product_id') productId: string,
    @Body('variant_id') variantId?: string, 
    @Body('sort_order') sortOrder?: string,
  ) {
    const parsedSortOrder = sortOrder !== undefined ? parseInt(sortOrder, 10) : undefined;
    return this.productImageService.create(productId, file, variantId, parsedSortOrder);
  }

  @Get()
  findAll() {
    return this.productImageService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productImageService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', productImageUpload))
  update(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.productImageService.update(id, file);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.productImageService.remove(id);
  }
}