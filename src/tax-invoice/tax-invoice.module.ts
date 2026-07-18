import { Module } from '@nestjs/common';
import { TaxInvoiceController } from './tax-invoice.controller';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

@Module({
  imports: [
    MulterModule.register({
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
          cb(new Error('Format file tidak didukung. Gunakan JPG, PNG, atau PDF.'), false);
        }
      },
    }),
  ],
  controllers: [TaxInvoiceController],
})
export class TaxInvoiceModule {}