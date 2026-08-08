import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * Konfigurasi upload gambar yang AMAN untuk dipakai ulang lintas controller.
 *
 * Fitur keamanan:
 * - Whitelist MIME type (bukan hanya ekstensi) untuk mencegah upload file berbahaya.
 * - Batas ukuran file (default 5MB) untuk mencegah abuse bandwidth / DoS memori.
 * - Nama file dibuat acak (UUID) — tidak pernah memakai nama asli uploader,
 *   sehingga mencegah path traversal & nama file eksploitatif.
 * - Ekstensi disimpan sesuai suffix asli (mirip perilaku lama), tetapi nama basisnya acak.
 */
export interface ImageUploadOptions {
  /** Direktori tujuan (jika tidak absolut, resolusi mengikuti process.cwd()) */
  destination: string;
  /** Daftar MIME yang diizinkan (default: JPEG/PNG/WebP/GIF — tanpa SVG untuk hindari stored XSS) */
  allowedMimes?: string[];
  /** Batas ukuran file dalam byte (default: 5MB) */
  maxSizeBytes?: number;
  /** Prefix nama file (default: 'img') */
  filePrefix?: string;
}

const DEFAULT_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export function imageUploadOptions(opts: ImageUploadOptions) {
  const allowedMimes = opts.allowedMimes ?? DEFAULT_IMAGE_MIMES;
  const maxSize = opts.maxSizeBytes ?? 5 * 1024 * 1024;
  const prefix = opts.filePrefix ?? 'img';

  return {
    storage: diskStorage({
      destination: opts.destination,
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        cb(null, `${prefix}-${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: maxSize },
    fileFilter: (
      _req: any,
      file: Express.Multer.File,
      cb: (error: any, accept: boolean) => void,
    ) => {
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new BadRequestException(
            `Format file tidak diizinkan. Hanya: ${allowedMimes.join(', ')}`,
          ),
          false,
        );
      }
    },
  };
}
