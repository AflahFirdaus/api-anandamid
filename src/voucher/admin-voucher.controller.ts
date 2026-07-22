import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  HttpCode,
  ParseUUIDPipe,
  ParseBoolPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { VoucherService } from './voucher.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { JwtAdminGuard } from '../user/guards/jwt-admin.guard';

interface ApiResponseWrapper<T = any> {
  statusCode: number;
  message: string;
  data?: T;
}

@ApiTags('Admin - Vouchers')
@ApiBearerAuth('JWT-auth')
@Controller('admin/vouchers')
@UseGuards(JwtAdminGuard)
export class AdminVoucherController {
  private readonly logger = new Logger(AdminVoucherController.name);

  constructor(private readonly voucherService: VoucherService) {}

  // ──────────────────────────────────────────────
  //  POST /admin/vouchers
  //  Generate voucher baru
  // ──────────────────────────────────────────────

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Buat voucher baru',
    description:
      'Membuat voucher baru dengan validasi lengkap. Hanya admin yang dapat mengakses.',
  })
  @ApiBody({ type: CreateVoucherDto })
  @ApiResponse({
    status: 201,
    description: 'Voucher berhasil dibuat',
  })
  @ApiResponse({
    status: 400,
    description: 'Validasi gagal (misal: kode duplikat, endDate < startDate)',
  })
  @ApiResponse({
    status: 401,
    description: 'Token tidak valid / bukan admin',
  })
  async createVoucher(
    @Body() dto: CreateVoucherDto,
  ): Promise<ApiResponseWrapper> {
    this.logger.log(`Admin creating voucher: ${dto.code}`);

    const voucher = await this.voucherService.createVoucher(dto);

    return {
      statusCode: HttpStatus.CREATED,
      message: `Voucher "${voucher.code}" berhasil dibuat`,
      data: voucher,
    };
  }

  // ──────────────────────────────────────────────
  //  GET /admin/vouchers
  //  Daftar semua voucher + statistik usage
  // ──────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Daftar semua voucher',
    description:
      'Mengembalikan semua voucher (aktif & non-aktif) lengkap dengan statistik currentUsage vs maxUsage.',
  })
  @ApiResponse({
    status: 200,
    description: 'Daftar voucher berhasil diambil',
  })
  @ApiResponse({
    status: 401,
    description: 'Token tidak valid / bukan admin',
  })
  async getAllVouchers(
    @Query('showHidden', new ParseBoolPipe({ optional: true })) showHidden?: boolean,
  ): Promise<ApiResponseWrapper> {
    this.logger.log(`Admin fetching all vouchers (showHidden: ${showHidden ?? false})`);

    const vouchers = await this.voucherService.getAllVouchersWithStats(showHidden ?? false);

    return {
      statusCode: HttpStatus.OK,
      message: `${vouchers.length} voucher ditemukan`,
      data: vouchers,
    };
  }

  // ──────────────────────────────────────────────
  //  PATCH /admin/vouchers/:id/toggle-status
  //  Toggle isActive
  // ──────────────────────────────────────────────

  @Patch(':id/toggle-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle status aktif/non-aktif voucher',
    description:
      'Mengubah status isActive voucher secara manual. Aktif → Non-aktif, dan sebaliknya.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'UUID voucher',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Status voucher berhasil diubah',
  })
  @ApiResponse({
    status: 404,
    description: 'Voucher tidak ditemukan',
  })
  @ApiResponse({
    status: 401,
    description: 'Token tidak valid / bukan admin',
  })
  async toggleVoucherStatus(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseWrapper> {
    this.logger.log(`Admin toggling voucher status: ${id}`);

    const result = await this.voucherService.toggleVoucherStatus(id);

    return {
      statusCode: HttpStatus.OK,
      message: `Voucher "${result.code}" sekarang ${result.isActive ? 'AKTIF' : 'NON-AKTIF'}`,
      data: result,
    };
  }

  // ──────────────────────────────────────────────
  //  PATCH /admin/vouchers/:id/toggle-hide
  //  Toggle is_hidden
  // ──────────────────────────────────────────────

  @Patch(':id/toggle-hide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle hide/show voucher',
    description:
      'Mengubah status is_hidden voucher. Hidden → Visible, dan sebaliknya. Voucher yang di-hide tidak muncul di list default.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'UUID voucher',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Status hide voucher berhasil diubah',
  })
  @ApiResponse({
    status: 404,
    description: 'Voucher tidak ditemukan',
  })
  @ApiResponse({
    status: 401,
    description: 'Token tidak valid / bukan admin',
  })
  async toggleVoucherHide(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponseWrapper> {
    this.logger.log(`Admin toggling voucher hide: ${id}`);

    const result = await this.voucherService.toggleVoucherHide(id);

    return {
      statusCode: HttpStatus.OK,
      message: `Voucher "${result.code}" sekarang ${result.isHidden ? 'DIHIDE' : 'TERLIHAT'}`,
      data: result,
    };
  }
}
