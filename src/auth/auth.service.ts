import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { AdminService } from '../admin/admin.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AdminLogService } from 'src/admin-log/admin-log.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private adminService: AdminService,
    private jwtService: JwtService,
    private adminLogService: AdminLogService,
  ) {}

  async login(username: string, password: string, ip?: string, userAgent?: string) {
    const admin = await this.adminService.findByUsername(username);

    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: admin.id, username: admin.username, role: 'ADMIN' };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m', 
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    const hashedRT = await bcrypt.hash(refreshToken, 10);
    await this.adminService.updateRefreshToken(admin.id, hashedRT);

    try {
      await this.adminLogService.logLogin(admin.id, ip, userAgent);
    } catch (error) {
      this.logger.error(`Gagal mencatat log login untuk admin ${admin.id}`, error);
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900,
      user: {
        id: admin.id,
        username: admin.username,
      },
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const admin = await this.adminService.findByIdWithRT(payload.sub);

      if (!admin || !admin.hashed_refresh_token) {
        throw new UnauthorizedException('Access denied');
      }

      const match = await bcrypt.compare(refreshToken, admin.hashed_refresh_token);

      // ==========================================
      // REUSE DETECTION (ANTI-HIJACK)
      // ==========================================
      if (!match) {
        await this.adminService.updateRefreshToken(admin.id, null);
        this.logger.warn(`SECURITY ALERT: Reuse detection triggered for admin ${admin.id}`);
        throw new UnauthorizedException('Security breach detected. Session revoked.');
      }

      const newPayload = { sub: admin.id, username: admin.username, role: 'ADMIN' };

      const newAccessToken = this.jwtService.sign(newPayload, {
        expiresIn: '15m',
      });

      const newRefreshToken = this.jwtService.sign(newPayload, {
        expiresIn: '7d',
      });

      const hashedRT = await bcrypt.hash(newRefreshToken, 10);
      await this.adminService.updateRefreshToken(admin.id, hashedRT);

      return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        expires_in: 900,
      };

    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(adminId: string) {
    await this.adminService.updateRefreshToken(adminId, null);
    return {
      message: 'Logged out successfully',
    };
  }
}