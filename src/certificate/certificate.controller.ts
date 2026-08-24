import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';

@Controller('certificates')
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  /**
   * 🔒 Hanya admin yang bisa membuat sertifikat baru
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateCertificateDto) {
    return this.certificateService.create(dto);
  }

  /**
   * 🔒 Hanya admin yang bisa melihat daftar semua sertifikat
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() {
    return this.certificateService.findAll();
  }

  /**
   * ✅ Publik — anak magang mencari sertifikat mereka via nama / nomor
   */
  @Get('search')
  search(@Query('q') q: string) {
    return this.certificateService.search(q);
  }

  /**
   * ✅ Publik — verifikasi & download sertifikat via QR Code / link
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.certificateService.findOneById(id);
  }
}
