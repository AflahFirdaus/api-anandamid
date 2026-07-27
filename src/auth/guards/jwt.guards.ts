import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw (
        err || new UnauthorizedException('Token tidak valid atau sudah expired')
      );
    }

    // 🔒 Admin-only guard: hanya user dengan role ADMIN yang bisa akses
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Akses ditolak! Hanya admin yang diizinkan.',
      );
    }

    return user;
  }
}
