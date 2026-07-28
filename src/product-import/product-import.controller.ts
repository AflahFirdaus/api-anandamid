import {
  Controller,
  Get,
  Res,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Query,
  Sse,
  MessageEvent,
  Logger,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductImportService } from './product-import.service';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guards';
import { TemplateCacheService } from './template-cache.service';
import { ProductImportProgressService } from './product-import-progress.service';

@Controller('product-import')
export class ProductImportController {
  private readonly logger = new Logger(ProductImportController.name);

  constructor(
    private readonly productImportService: ProductImportService,
    private readonly templateCacheService: TemplateCacheService,
    private readonly progressService: ProductImportProgressService,
  ) {}

  @Sse('progress')
  @UseGuards(JwtAuthGuard)
  sendProgress(): Observable<MessageEvent> {
    return this.progressService
      .getEventStream()
      .pipe(map((data) => ({ data }) as MessageEvent));
  }

  @Sse('progress/:token')
  sendProgressWithToken(
    @Query('token') token: string,
  ): Observable<MessageEvent> {
    return this.progressService
      .getEventStream()
      .pipe(map((data) => ({ data }) as MessageEvent));
  }

  @Get('template')
  @UseGuards(JwtAuthGuard)
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.productImportService.generateTemplate();

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=product_template.xlsx',
    });

    res.send(buffer);
  }

  @Get('template-update')
  @UseGuards(JwtAuthGuard)
  async downloadUpdateTemplate(
    @Query('category_code') categoryCode: string,
    @Query('only_with_sku') onlyWithSku: string,
    @Query('force') force: string,
    @Res() res: Response,
  ) {
    const categoryCodes = categoryCode ? categoryCode.split(',') : undefined;
    const isOnlySku = onlyWithSku === undefined ? true : onlyWithSku === 'true';
    const isForce = force === 'true';

    let filePath: string;

    if (!isForce) {
      try {
        filePath = await this.templateCacheService.get(
          categoryCodes,
          isOnlySku,
        );
        return res.download(filePath, 'product-update-template.xlsx');
      } catch {}
    }

    const buffer = await this.productImportService.generateUpdateTemplate(
      categoryCodes,
      isOnlySku,
    );

    filePath = await this.templateCacheService.save(
      buffer,
      categoryCodes,
      isOnlySku,
    );

    return res.download(filePath, 'product-update-template.xlsx');
  }

  // ==========================
  // CEK STATUS TEMPLATE (UNTUK COUNTDOWN)
  // ==========================
  @Get('template-update/status')
  @UseGuards(JwtAuthGuard)
  async getTemplateStatus(
    @Query('category_code') categoryCode: string,
    @Query('only_with_sku') onlyWithSku: string,
  ) {
    const categoryCodes = categoryCode ? categoryCode.split(',') : undefined;
    const isOnlySku = onlyWithSku === undefined ? true : onlyWithSku === 'true';

    try {
      const data = await this.templateCacheService.getWithMeta(
        categoryCodes,
        isOnlySku,
      );

      return {
        available: true,
        expires_at: data.expiresAt,
      };
    } catch {
      return {
        available: false,
        expires_at: null,
      };
    }
  }

  // ==========================
  // DOWNLOAD FILE CACHE SAJA (TANPA GENERATE)
  // ==========================
  @Get('template-update/download')
  @UseGuards(JwtAuthGuard)
  async downloadCachedTemplate(
    @Query('category_code') categoryCode: string,
    @Query('only_with_sku') onlyWithSku: string,
    @Res() res: Response,
  ) {
    const categoryCodes = categoryCode ? categoryCode.split(',') : undefined;
    const isOnlySku = onlyWithSku === undefined ? true : onlyWithSku === 'true';

    const filePath = await this.templateCacheService.get(
      categoryCodes,
      isOnlySku,
    );

    return res.download(filePath, 'product-update-template.xlsx');
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadProducts(@UploadedFile() file: Express.Multer.File) {
    const fileSizeKB = (file.size / 1024).toFixed(1);
    this.logger.log(`📥 [UPLOAD MASSAL] File diterima: "${file.originalname}" (${fileSizeKB} KB)`);
    this.logger.log(`⚙️  [UPLOAD MASSAL] Memulai proses background upload...`);

    this.productImportService.uploadProducts(file.buffer).catch((err) => {
      this.logger.error(`❌ [UPLOAD MASSAL] Background upload error: ${err.message}`, err.stack);
    });

    this.logger.log(`✅ [UPLOAD MASSAL] File diterima, background job dimulai. Balasan dikirim ke client.`);
    return {
      message: 'File diterima. Proses upload sedang berjalan di background.',
    };
  }

  @Post('update')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async updateProducts(@UploadedFile() file: Express.Multer.File) {
    const fileSizeKB = (file.size / 1024).toFixed(1);
    this.logger.log(`📥 [UPDATE MASSAL] File diterima: "${file.originalname}" (${fileSizeKB} KB)`);
    this.logger.log(`⚙️  [UPDATE MASSAL] Memulai proses background update...`);

    this.productImportService.updateProducts(file.buffer).catch((err) => {
      this.logger.error(`❌ [UPDATE MASSAL] Background update error: ${err.message}`, err.stack);
    });

    this.logger.log(`✅ [UPDATE MASSAL] File diterima, background job dimulai. Balasan dikirim ke client.`);
    return {
      message: 'File diterima. Proses update sedang berjalan di background.',
    };
  }
}
