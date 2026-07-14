import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { Request } from 'express';
import { JwtAuthGuard } from './guards/jwt.guards';
import { ThrottleFeature, ThrottlerFeature } from '../common/throttler';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ThrottleFeature(ThrottlerFeature.AUTH)
  @Post('login')
  async login(
    @Body() body: { username: string; password: string },
    @Req() req: Request,
  ) {
    return this.authService.login(
      body.username,
      body.password,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('refresh')
  async refresh(
    @Body() body: { refresh_token: string },
  ) {
    return this.authService.refresh(body.refresh_token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req: any) {
    return this.authService.logout(req.user.id);
  }
}