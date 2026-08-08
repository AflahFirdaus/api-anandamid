import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UploadedFile,
  UseInterceptors,
  Patch,
  Query, // 🔥 Jangan lupa import Query
} from "@nestjs/common";

import { FileInterceptor } from "@nestjs/platform-express";
import { BrandService } from "./brand.service";
import { UpdateBrandDto } from "./dto/update-brand.dto";
import { UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt.guards";
import { imageUploadOptions } from "../common/multer-image.options";

// 🔒 Hanya gambar (JPG/PNG/WebP/GIF) maks 5MB — nama file acak (UUID).
const brandStorage = imageUploadOptions({
  destination: "./uploads/brands",
  filePrefix: "brand",
  maxSizeBytes: 5 * 1024 * 1024,
});

@Controller("brands")
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("image", brandStorage))
  create(
    @Body("name") name: string,
    @Body("is_active") isActiveStr?: string, 
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imagePath = file
      ? `/uploads/brands/${file.filename}`
      : null;

    const is_active = isActiveStr === 'true';

    return this.brandService.create({ name, is_active }, imagePath);
  }

  @Get()
  findAll(@Query('is_active') isActive?: string) { 
    return this.brandService.findAll(isActive);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.brandService.findOne(id);
  }

  @Put(":id")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("image", brandStorage))
  update(
    @Param("id") id: string,
    @Body() dto: UpdateBrandDto & { is_active?: string }, 
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imagePath = file
      ? `/uploads/brands/${file.filename}`
      : undefined;

    return this.brandService.update(id, dto, imagePath);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  remove(@Param("id") id: string) {
    return this.brandService.delete(id);
  }

  @Patch(":id/assign-products")
  @UseGuards(JwtAuthGuard)
  assignProducts(
    @Param("id") id: string,
    @Body("product_ids") productIds: string[],
  ) {
    return this.brandService.assignProducts(id, productIds);
  }
}