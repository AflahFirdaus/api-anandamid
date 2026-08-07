import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';
import { EventService } from './event.service';
import { EventStatus } from './entities/event.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateResponseStatusDto } from './dto/update-response-status.dto';
import { UpdateEventStatusDto } from './dto/update-event-status.dto';
import { UpdateEventDto } from './dto/update-event.dto';

interface ApiResponseWrapper<T = any> {
  statusCode: number;
  message: string;
  data?: T;
}

@ApiTags('Admin - Events')
@ApiBearerAuth('JWT-auth')
@Controller('admin/events')
@UseGuards(JwtAuthGuard)
export class AdminEventController {
  constructor(private readonly eventService: EventService) {}

  // ──────────────────────────────────────────────
  //  POST /admin/events — Buat event baru
  // ──────────────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Buat event baru' })
  @ApiBody({ type: CreateEventDto })
  @ApiResponse({ status: 201, description: 'Event berhasil dibuat' })
  @ApiResponse({ status: 400, description: 'Validasi gagal' })
  async createEvent(@Body() dto: CreateEventDto): Promise<ApiResponseWrapper> {
    const event = await this.eventService.createEvent(dto);
    return {
      statusCode: HttpStatus.CREATED,
      message: `Event "${event.title}" berhasil dibuat`,
      data: event,
    };
  }

  // ──────────────────────────────────────────────
  //  POST /admin/events/:id/poster — Upload poster acara (gambar)
  // ──────────────────────────────────────────────
  @Post(':id/poster')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dest = join(process.cwd(), 'uploads', 'events', 'posters');
          fs.mkdirSync(dest, { recursive: true });
          cb(null, dest);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `poster-${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Hanya file gambar (JPG, PNG, WebP) yang diperbolehkan untuk poster.',
            ),
            false,
          );
        }
      },
    }),
  )
  @ApiOperation({
    summary: 'Upload / ganti poster acara',
    description:
      'Upload gambar poster event (disarankan rasio 3:2, mis. 1200x800 px). File: multipart field "file".',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', type: 'string', description: 'UUID event' })
  @ApiResponse({ status: 200, description: 'Poster berhasil disimpan' })
  async uploadPoster(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiResponseWrapper> {
    if (!file) {
      throw new BadRequestException('File poster wajib diunggah.');
    }
    const posterUrl = `/uploads/events/posters/${file.filename}`;
    const event = await this.eventService.setEventPoster(id, posterUrl);
    return {
      statusCode: HttpStatus.OK,
      message: `Poster event "${event.title}" berhasil disimpan`,
      data: event,
    };
  }


  // ──────────────────────────────────────────────
  //  GET /admin/events — Daftar semua event
  // ──────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'Daftar semua event' })
  @ApiResponse({ status: 200, description: 'Daftar event berhasil diambil' })
  async findAllEvents(): Promise<ApiResponseWrapper> {
    const events = await this.eventService.findAllEvents();
    return {
      statusCode: HttpStatus.OK,
      message: `${events.length} event ditemukan`,
      data: events,
    };
  }

  // ──────────────────────────────────────────────
  //  GET /admin/events/:id — Detail satu event
  // ──────────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Detail satu event' })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID event' })
  @ApiResponse({ status: 200, description: 'Detail event berhasil diambil' })
  @ApiResponse({ status: 404, description: 'Event tidak ditemukan' })
  async findEventById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseWrapper> {
    const event = await this.eventService.findEventById(id);
    return {
      statusCode: HttpStatus.OK,
      message: 'Detail event berhasil diambil',
      data: event,
    };
  }

  // ──────────────────────────────────────────────
  //  GET /admin/events/:id/responses — Semua pendaftar
  // ──────────────────────────────────────────────
  @Get(':id/responses')
  @ApiOperation({ summary: 'Seluruh data pendaftar pada sebuah event' })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID event' })
  @ApiResponse({
    status: 200,
    description: 'Daftar pendaftar berhasil diambil',
  })
  @ApiResponse({ status: 404, description: 'Event tidak ditemukan' })
  async findEventResponses(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseWrapper> {
    const responses = await this.eventService.findEventResponses(id);
    return {
      statusCode: HttpStatus.OK,
      message: `${responses.length} pendaftar ditemukan`,
      data: responses,
    };
  }

  // ──────────────────────────────────────────────
  //  GET /admin/events/:id/responses/export
  //  Download pendaftar dalam format Excel (.xlsx)
  // ──────────────────────────────────────────────
  @Get(':id/responses/export')
  @ApiOperation({ summary: 'Export pendaftar event ke Excel (.xlsx)' })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID event' })
  async exportResponsesExcel(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } =
      await this.eventService.exportResponsesExcel(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  // ──────────────────────────────────────────────
  //  PATCH /admin/events/responses/:response_id/status
  //  Ubah status pendaftar (Pending → Approved/Rejected)
  // ──────────────────────────────────────────────
  @Patch('responses/:response_id/status')
  @ApiOperation({
    summary: 'Ubah status pendaftar',
    description: 'Mengubah status pendaftar menjadi Approved atau Rejected.',
  })
  @ApiParam({
    name: 'response_id',
    type: 'string',
    description: 'UUID pendaftar (event_response)',
  })
  @ApiBody({ type: UpdateResponseStatusDto })
  @ApiResponse({
    status: 200,
    description: 'Status pendaftar berhasil diubah',
  })
  @ApiResponse({ status: 404, description: 'Pendaftar tidak ditemukan' })
  async updateResponseStatus(
    @Param('response_id', ParseUUIDPipe) responseId: string,
    @Body() dto: UpdateResponseStatusDto,
  ): Promise<ApiResponseWrapper> {
    const response = await this.eventService.updateResponseStatus(
      responseId,
      dto.status,
      dto.rejection_reason,
    );
    return {
      statusCode: HttpStatus.OK,
      message: `Status pendaftar "${response.name}" diubah menjadi ${response.status}`,
      data: response,
    };
  }

  // ──────────────────────────────────────────────
  //  PATCH /admin/events/:id/status
  //  Ubah status event (draft ↔ published)
  // ──────────────────────────────────────────────
  @Patch(':id')
  @ApiOperation({
    summary: 'Update event',
    description:
      'Mengubah data event. Semua field opsional — hanya field yang dikirim yang diperbarui.',
  })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID event' })
  @ApiBody({ type: UpdateEventDto })
  @ApiResponse({ status: 200, description: 'Event berhasil diperbarui' })
  @ApiResponse({ status: 404, description: 'Event tidak ditemukan' })
  async updateEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ): Promise<ApiResponseWrapper> {
    const event = await this.eventService.updateEvent(id, dto);
    return {
      statusCode: HttpStatus.OK,
      message: `Event "${event.title}" berhasil diperbarui`,
      data: event,
    };
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Ubah status event (publish / unpublish)',
    description:
      'Mengubah status event antara draft dan published. Event published akan tampil di halaman publik.',
  })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID event' })
  @ApiBody({ type: UpdateEventStatusDto })
  @ApiResponse({
    status: 200,
    description: 'Status event berhasil diubah',
  })
  @ApiResponse({ status: 404, description: 'Event tidak ditemukan' })
  async updateEventStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventStatusDto,
  ): Promise<ApiResponseWrapper> {
    const event = await this.eventService.updateEventStatus(id, dto.status);
    return {
      statusCode: HttpStatus.OK,
      message: `Event "${event.title}" kini ${event.status === EventStatus.PUBLISHED ? 'published' : 'draft'}`,
      data: event,
    };
  }
}
