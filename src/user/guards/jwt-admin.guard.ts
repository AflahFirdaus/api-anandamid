import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard khusus Admin — hanya user dengan role 'ADMIN' yang bisa akses.
 * Token JWT diambil dari Authorization: Bearer <token>.
 */
@Injectable()
export class JwtAdminGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Token tidak valid atau sudah expired');
    }

    if (user.role !== 'ADMIN') {
      throw new UnauthorizedException(
        'Akses ditolak! Hanya admin yang diizinkan mengakses endpoint ini.',
      );
    }

    return user;
  }
}