import { Controller, Post, Body, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt.guards';
import { ThrottleFeature, ThrottlerFeature } from '../common/throttler';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  private getCookieOptions(req?: Request): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'none' | 'lax';
    path: string;
  } {
    const isHttpsOrProd =
      process.env.NODE_ENV === 'production' ||
      process.env.NODE_ENV === 'staging' ||
      req?.secure ||
      req?.headers['x-forwarded-proto'] === 'https';

    return {
      httpOnly: true,
      secure: isHttpsOrProd,
      sameSite: isHttpsOrProd ? 'none' : 'lax',
      path: '/',
    };
  }

  private readonly ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000; // 15 menit
  private readonly REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 hari

  @ThrottleFeature(ThrottlerFeature.AUTH)
  @Post('login')
  async login(
    @Body() body: { username: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(
      body.username,
      body.password,
      req.ip,
      req.headers['user-agent'],
    );

    const cookieOpts = this.getCookieOptions(req);

    // Set httpOnly cookies
    res.cookie('access_token', result.access_token, {
      ...cookieOpts,
      maxAge: this.ACCESS_TOKEN_MAX_AGE,
    });
    res.cookie('refresh_token', result.refresh_token, {
      ...cookieOpts,
      maxAge: this.REFRESH_TOKEN_MAX_AGE,
    });

    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_in: result.expires_in,
      user: result.user,
    };
  }

  @Post('refresh')
  async refresh(
    @Body() body: { refresh_token?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Ambil refresh_token dari cookie dulu, fallback ke body
    const refreshToken = req.cookies?.refresh_token || body.refresh_token;

    const result = await this.authService.refresh(refreshToken);

    const cookieOpts = this.getCookieOptions(req);

    // Update access_token cookie
    res.cookie('access_token', result.access_token, {
      ...cookieOpts,
      maxAge: this.ACCESS_TOKEN_MAX_AGE,
    });

    // Kirim refresh_token baru
    res.cookie('refresh_token', result.refresh_token, {
      ...cookieOpts,
      maxAge: this.REFRESH_TOKEN_MAX_AGE,
    });

    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_in: result.expires_in,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: Request & { user?: { id: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(req.user!.id);

    const cookieOpts = this.getCookieOptions(req);

    // Clear cookies
    res.clearCookie('access_token', cookieOpts);
    res.clearCookie('refresh_token', cookieOpts);

    return { message: 'Logged out successfully' };
  }
}