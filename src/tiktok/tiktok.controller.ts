import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { TiktokService } from './tiktok.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';

@Controller('tiktok')
export class TiktokController {
  constructor(private readonly tiktokService: TiktokService) {}

  @Get('live-status')
  getLiveStatus() {
    return this.tiktokService.getLiveStatus();
  }

  @Post('live-toggle')
  @UseGuards(JwtAuthGuard)
  setLiveStatus(@Body('is_live') isLive: boolean) {
    return this.tiktokService.setLiveStatus(isLive);
  }
}
