import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Patch,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BannerImageService } from './banner.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';
import { imageUploadOptions } from '../common/multer-image.options';

// 🔒 Hanya gambar (JPG/PNG/WebP/GIF) maks 5MB — nama file acak (UUID).
const bannerUpload = imageUploadOptions({
  destination: './uploads/banner',
  filePrefix: 'banner',
  maxSizeBytes: 5 * 1024 * 1024,
});

@Controller('banner-image')
export class BannerImageController {
  constructor(private readonly bannerService: BannerImageService) {}

  private parseArrayData(data: any): string[] | undefined {
    if (!data) return undefined;
    if (Array.isArray(data)) return data; 
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        return data.split(',').map((item) => item.trim()).filter(Boolean);
      }
    }
    return undefined;
  }

  @Get()
  async findAll() {
    return this.bannerService.findAll();
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', bannerUpload))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('slot') slot: string,
    @Body('promo') promo?: string, 
    @Body('categoryIds') rawCategoryIds?: any,
    @Body('brandIds') rawBrandIds?: any,
  ) {
    if (!file) {
      throw new Error('File tidak ditemukan');
    }
    if (!slot) {
      throw new Error('Slot tidak terkirim');
    }

    const categoryIds = this.parseArrayData(rawCategoryIds);
    const brandIds = this.parseArrayData(rawBrandIds);
    const imageUrl = `/uploads/banner/${file.filename}`;

    return this.bannerService.create(
      imageUrl,
      slot,
      categoryIds,
      brandIds,
      promo, 
    );
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', bannerUpload))
  async update(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('promo') promo?: string, 
    @Body('categoryIds') rawCategoryIds?: any,
    @Body('brandIds') rawBrandIds?: any,
  ) {
    const categoryIds = this.parseArrayData(rawCategoryIds);
    const brandIds = this.parseArrayData(rawBrandIds);
    
    if (!file) {
      throw new Error('File tidak ditemukan');
    }

    const imageUrl = `/uploads/banner/${file.filename}`;
    
    return this.bannerService.update(id, imageUrl, categoryIds, brandIds, promo); 
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    await this.bannerService.remove(id);
    return { message: 'Banner berhasil dihapus' };
  }

  @Patch(':id/title')
  @UseGuards(JwtAuthGuard)
  async updateTitle(
    @Param('id') id: string,
    @Body('title') title: string,
  ) {
    return this.bannerService.updateTitle(id, title);
  }

  @Get('slot/:slot')
  async findBySlot(@Param('slot') slot: string) {
    return this.bannerService.findBySlot(slot);
  }

  @Patch(':id/slot')
  @UseGuards(JwtAuthGuard)
  async updateSlot(
    @Param('id') id: string,
    @Body('slot') slot: string,
  ) {
    return this.bannerService.updateSlot(id, slot);
  }

  @Patch(':id/metadata')
  @UseGuards(JwtAuthGuard)
  async updateMetadata(
    @Param('id') id: string,
    @Body() body: { slot?: string; promo?: string; categoryIds?: string[]; brandIds?: string[] },
  ) {
    return this.bannerService.updateMetadata(id, body);
  }
}