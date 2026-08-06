import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  BadRequestException,
  UploadedFiles,
  UseInterceptors,
  HttpStatus,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { EventService } from './event.service';
import { SubmitEventResponseDto } from './dto/submit-event-response.dto';

interface ApiResponseWrapper<T = any> {
  statusCode: number;
  message: string;
  data?: T;
}

export type UploadedEventFiles = {
  proof_of_follow?: Express.Multer.File[];
  proof_of_review?: Express.Multer.File[];
};

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

@ApiTags('Public - Events')
@Controller('public/events')
export class PublicEventController {
  constructor(private readonly eventService: EventService) {}

  // ──────────────────────────────────────────────
  //  GET /public/events — Daftar semua event published
  // ──────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'Daftar event publik (hanya published)' })
  @ApiResponse({ status: 200, description: 'Daftar event berhasil diambil' })
  async findAllPublished(): Promise<ApiResponseWrapper> {
    const events = await this.eventService.findAllPublishedEvents();
    return {
      statusCode: HttpStatus.OK,
      message: `${events.length} event ditemukan`,
      data: events,
    };
  }


  // ──────────────────────────────────────────────
  //  GET /public/events/:slug — Detail event (hanya published)
  // ──────────────────────────────────────────────
  @Get(':slug')
  @ApiOperation({ summary: 'Detail event berdasarkan slug (untuk frontend)' })
  @ApiParam({ name: 'slug', type: 'string', description: 'Slug unik event' })
  @ApiResponse({ status: 200, description: 'Detail event berhasil diambil' })
  @ApiResponse({
    status: 404,
    description: 'Event tidak ditemukan / belum publik',
  })
  async findBySlug(@Param('slug') slug: string): Promise<ApiResponseWrapper> {
    const event = await this.eventService.findPublishedEventBySlug(slug);
    return {
      statusCode: HttpStatus.OK,
      message: 'Detail event berhasil diambil',
      data: event,
    };
  }

  // ──────────────────────────────────────────────
  //  POST /public/events/:slug/submit — Daftar event (multipart)
  //  Menangani 2 file: proof_of_follow & proof_of_review
  // ──────────────────────────────────────────────
  @Post(':slug/submit')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'proof_of_follow', maxCount: 1 },
        { name: 'proof_of_review', maxCount: 1 },
      ],
      {
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            const dest = join(process.cwd(), 'uploads', 'events');
            fs.mkdirSync(dest, { recursive: true });
            cb(null, dest);
          },
          filename: (_req, file, cb) => {
            const ext = extname(file.originalname).toLowerCase();
            const safeName = `${file.fieldname}-${randomUUID()}${ext}`;
            cb(null, safeName);
          },
        }),
        limits: { fileSize: MAX_FILE_SIZE },
        fileFilter: (_req, file, cb) => {
          if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(
              new BadRequestException(
                'Hanya file gambar yang diperbolehkan (JPG, PNG, atau WebP)',
              ),
              false,
            );
          }
        },
      },
    ),
  )
  @ApiOperation({ summary: 'Submit pendaftaran event (multipart/form-data)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'Form data pendaftar + 2 file gambar (proof_of_follow & proof_of_review)',
    type: undefined,
  })
  @ApiResponse({ status: 201, description: 'Pendaftaran berhasil disimpan' })
  @ApiResponse({
    status: 400,
    description: 'Validasi gagal / di luar window / kuota penuh',
  })
  @ApiResponse({
    status: 404,
    description: 'Event tidak ditemukan / belum publik',
  })
  async submit(
    @Param('slug') slug: string,
    @UploadedFiles() files: UploadedEventFiles,
    @Body() dto: SubmitEventResponseDto,
  ): Promise<ApiResponseWrapper> {
    const proofOfFollow = files?.proof_of_follow?.[0];
    const proofOfReview = files?.proof_of_review?.[0];

    if (!proofOfFollow || !proofOfReview) {
      throw new BadRequestException(
        'Bukti follow (proof_of_follow) dan bukti review (proof_of_review) wajib diunggah',
      );
    }

    const response = await this.eventService.submitResponse(slug, files, dto);

    return {
      statusCode: HttpStatus.CREATED,
      message: 'Pendaftaran event berhasil dikirim dan menunggu review admin',
      data: response,
    };
  }
}
