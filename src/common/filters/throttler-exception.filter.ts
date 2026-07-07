import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Global exception filter untuk menangani ThrottlerException (HTTP 429).
 *
 * Memberikan response yang informatif dengan:
 * - statusCode: 429
 * - message: Pesan error yang user-friendly
 * - error: "Too Many Requests"
 * - retryAfter: Waktu (dalam detik) yang disarankan untuk menunggu
 * - timestamp: Waktu terjadinya error
 *
 * Juga menyertakan header Retry-After untuk kompatibilitas dengan client.
 */
@Catch(HttpException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    // Hanya handle 429 (Too Many Requests)
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      const exceptionResponse = exception.getResponse();

      // Jika exceptionResponse sudah berbentuk objek (dari custom guard),
      // gunakan langsung dengan tambahan timestamp
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = {
          ...exceptionResponse,
          timestamp: new Date().toISOString(),
        };

        return response.status(status).json(body);
      }

      // Jika masih string, bungkus dalam format standar
      return response.status(status).json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: exceptionResponse || 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
        error: 'Too Many Requests',
        retryAfter: 60,
        timestamp: new Date().toISOString(),
      });
    }

    // Untuk error lain, lempar ke default error handler NestJS
    // dengan tetap mempertahankan response asli
    const exceptionResponse = exception.getResponse();
    const errorBody =
      typeof exceptionResponse === 'object'
        ? exceptionResponse
        : {
            statusCode: status,
            message: exceptionResponse,
            timestamp: new Date().toISOString(),
          };

    return response.status(status).json(errorBody);
  }
}