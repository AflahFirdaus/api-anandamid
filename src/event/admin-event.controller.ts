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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';
import { EventService } from './event.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateResponseStatusDto } from './dto/update-response-status.dto';

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
    );
    return {
      statusCode: HttpStatus.OK,
      message: `Status pendaftar "${response.name}" diubah menjadi ${response.status}`,
      data: response,
    };
  }
}
