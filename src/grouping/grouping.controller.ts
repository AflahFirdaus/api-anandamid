import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { diskStorage } from 'multer';
import { extname } from 'path';

import { GroupingService } from './grouping.service';
import { CreateGroupingDto } from './dto/create-grouping.dto';
import { UpdateGroupingDto } from './dto/update-grouping.dto';
import { AssignCategoryDto } from './dto/assign-category.dto';

const multerOptions = {
  storage: diskStorage({
    destination: './uploads',
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`);
    },
  }),
};

@Controller('groupings')
export class GroupingController {
  constructor(private readonly service: GroupingService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('ungrouped')
  getUngrouped() {
    return this.service.getUngroupedCategories();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // 🔥 HELPER PARSE
  private parseChildIds(body: any): string[] | undefined {
    const raw = body['child_ids[]'] || body.child_ids;
    if (!raw) return undefined;
    if (Array.isArray(raw)) return raw;
    return [raw];
  }

  // ================= CREATE =================
  @Post()
  @UseInterceptors(FileInterceptor('image', multerOptions)) // Tambahkan multerOptions
  create(
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const dto: CreateGroupingDto = {
      name: body.name,
      // Sekarang file.filename sudah ada isinya karena pakai diskStorage
      image_url: file ? `/uploads/${file.filename}` : undefined,
      child_ids: this.parseChildIds(body) || [],
    };

    return this.service.create(dto);
  }

  // ================= UPDATE =================
  @Patch(':id')
  @UseInterceptors(FileInterceptor('image', multerOptions)) // Tambahkan multerOptions
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const dto: UpdateGroupingDto = {
      name: body.name,
      image_url: file ? `/uploads/${file.filename}` : undefined,
      child_ids: this.parseChildIds(body), 
    };

    return this.service.update(id, dto);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignCategoryDto) {
    return this.service.assignCategories(id, dto.category_ids);
  }

  @Patch('remove-category/:categoryId')
  remove(@Param('categoryId') categoryId: string) {
    return this.service.removeCategory(categoryId);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}