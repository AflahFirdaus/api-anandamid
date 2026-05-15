import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class HotlinkProtectionMiddleware implements NestMiddleware {
  private readonly allowedOrigins = [
    'anandam.id',
    'api-marketplace.anandamcomputer.com',
    'localhost',
    '127.0.0.1',
    'staging.anandam.id'
  ];

  use(req: Request, res: Response, next: NextFunction) {
    const referer = req.headers.referer || req.headers.referrer;

    // Jika path adalah /uploads/ dan referer tidak ada atau tidak valid
    if (req.path.startsWith('/uploads/')) {
      if (!referer) {
        throw new ForbiddenException('Direct access to images is not allowed.');
      }

      const isAllowed = this.allowedOrigins.some((origin) =>
        referer.includes(origin),
      );

      if (!isAllowed) {
        throw new ForbiddenException('Access denied (Hotlink Protection).');
      }
    }

    next();
  }
}
