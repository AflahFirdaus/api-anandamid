import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Query,
  UseGuards,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { VoucherService } from './voucher.service';
import { ApplyVoucherDto } from './dto/apply-voucher.dto';
import { JwtUserGuard } from '../user/guards/jwt-user.guard';
import { ThrottleFeature } from '../common/throttler/throttler-feature.decorator';
import { ThrottlerFeature } from '../common/throttler/throttler-feature.enum';

/**
 * Respons standar terstruktur untuk frontend.
 */
interface ApiResponseWrapper<T = any> {
  statusCode: number;
  message: string;
  data?: T;
}

@ApiTags('Vouchers')
@Controller('vouchers')
export class VoucherController {
  private readonly logger = new Logger(VoucherController.name);

  constructor(private readonly voucherService: VoucherService) {}

  // ──────────────────────────────────────────────
  //  GET /vouchers/eligible
  //  Mendapatkan daftar voucher yang tersedia
  // ──────────────────────────────────────────────

  @UseGuards(JwtUserGuard)
  @Get('eligible')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Daftar voucher yang eligible',
    description:
      'Mengembalikan semua voucher yang bisa digunakan user berdasarkan total belanja. UserId diambil dari token JWT.',
  })
  @ApiQuery({
    name: 'orderTotal',
    required: true,
    type: Number,
    description: 'Total belanja untuk filter min_purchase',
    example: 250000,
  })
  @ApiResponse({
    status: 200,
    description: 'Daftar voucher eligible ditemukan',
  })
  @ApiResponse({
    status: 401,
    description: 'Token tidak valid atau belum login',
  })
  async getEligibleVouchers(
    @Req() req: any,
    @Query('orderTotal') orderTotal: string,
  ): Promise<ApiResponseWrapper> {
    const userId: string = req.user.id;
    const total = parseFloat(orderTotal);

    if (isNaN(total) || total < 0) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Parameter orderTotal harus berupa angka positif',
      };
    }

    this.logger.log(
      `Fetching eligible vouchers for user ${userId} with orderTotal ${total}`,
    );

    const vouchers = await this.voucherService.getEligibleVouchers(
      userId,
      total,
    );

    return {
      statusCode: HttpStatus.OK,
      message: vouchers.length > 0
        ? `${vouchers.length} voucher tersedia`
        : 'Tidak ada voucher yang tersedia untuk pesanan ini',
      data: vouchers,
    };
  }

  // ──────────────────────────────────────────────
  //  POST /vouchers/apply
  //  Validasi + reserve voucher (rate-limited)
  // ──────────────────────────────────────────────

  @UseGuards(JwtUserGuard)
  @Post('apply')
  @ThrottleFeature(ThrottlerFeature.VOUCHER)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Aplikasikan kode voucher',
    description:
      'Validasi dan reserve voucher. UserId diambil dari token JWT (tidak dari body). Maksimal 5 percobaan per menit untuk mencegah brute-force.',
  })
  @ApiResponse({
    status: 200,
    description: 'Voucher berhasil diaplikasikan',
  })
  @ApiResponse({
    status: 400,
    description: 'Voucher tidak valid / habis / expired',
  })
  @ApiResponse({
    status: 401,
    description: 'Token tidak valid atau belum login',
  })
  @ApiResponse({
    status: 429,
    description: 'Terlalu banyak percobaan. Silakan coba lagi dalam 1 menit.',
  })
  async applyVoucher(
    @Req() req: any,
    @Body() dto: ApplyVoucherDto,
  ): Promise<ApiResponseWrapper> {
    const userId: string = req.user.id;

    this.logger.log(
      `User ${userId} applying voucher: ${dto.voucherCode}, orderTotal: ${dto.orderTotal}`,
    );

    const result = await this.voucherService.validateAndApplyVoucher(
      userId,
      dto.voucherCode,
      dto.orderTotal,
      dto.productIds,
    );

    return {
      statusCode: HttpStatus.OK,
      message: `Voucher ${dto.voucherCode} berhasil diaplikasikan! Potongan Rp ${result.discountResult.discountAmount.toLocaleString('id-ID')}`,
      data: {
        voucherCode: result.voucher.code,
        voucherName: result.voucher.name,
        discountAmount: result.discountResult.discountAmount,
        discountLabel: result.discountResult.discountLabel,
        finalTotal: result.finalTotal,
        usageId: result.usageId,
      },
    };
  }
}