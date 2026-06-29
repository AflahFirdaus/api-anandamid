import type { ThrottlerModuleOptions } from '@nestjs/throttler';

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      ttl: 60000, // 60 detik
      limit: 100, // maksimal 100 request per menit per IP
    },
  ],
  errorMessage: 'Terlalu banyak permintaan. Silakan coba lagi dalam 1 menit.',
};
