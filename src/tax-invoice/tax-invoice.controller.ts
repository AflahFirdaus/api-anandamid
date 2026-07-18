import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtUserGuard } from '../user/guards/jwt-user.guard';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

@Controller('api/tax-invoice')
export class TaxInvoiceController {
  /**
   * Upload NPWP document
   */
  @Post('upload-npwp')
  @UseGuards(JwtUserGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'tax-invoices', 'npwp'),
        filename: (req, file, cb) => {
          const ext = extname(file.originalname);
          const filename = `npwp-${uuidv4()}${ext}`;
          cb(null, filename);
        },
      }),
      limits: {
        fileSize: 2 * 1024 * 1024, // 2MB
      },
      fileFilter: (req, file, cb) => {
        const allowedMimes = ['image/jpeg', 'image/png', 'application/pdf'];
        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Format file tidak didukung. Gunakan JPG, PNG, atau PDF.'), false);
        }
      },
    }),
  )
  async uploadNpwp(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File tidak ditemukan');
    }

    const url = `/uploads/tax-invoices/npwp/${file.filename}`;

    return {
      success: true,
      data: {
        url,
        filename: file.filename,
        originalname: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      },
    };
  }
}