import {
  Controller,
  Post,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create-transaction')
  @ApiOperation({ summary: 'Create Midtrans transaction', description: 'Generate a Snap payment token and redirect URL for the given order.' })
  @ApiBody({ type: CreateTransactionDto })
  @ApiResponse({ status: 200, description: 'Transaction token created successfully' })
  @ApiResponse({ status: 400, description: 'orderId and grossAmount are required' })
  @ApiResponse({ status: 500, description: 'Midtrans API error' })
  async createTransaction(
    @Body()
    body: {
      orderId: string;
      grossAmount: number;
      customerDetails?: any;
    },
  ) {
    if (!body.orderId || !body.grossAmount) {
      throw new HttpException(
        'orderId dan grossAmount wajib diisi',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const result = await this.paymentService.createTransaction(
        body.orderId,
        body.grossAmount,
        body.customerDetails,
      );
      return {
        statusCode: HttpStatus.OK,
        message: 'Transaction token created successfully',
        data: result,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Midtrans webhook', description: 'Receive payment notifications from Midtrans. Used internally by Midtrans; no auth required.' })
  @ApiResponse({ status: 200, description: 'OK — notification acknowledged' })
  @ApiResponse({ status: 500, description: 'Failed to process notification' })
  async handleWebhook(@Body() body: any) {
    try {
      await this.paymentService.handleNotification(body);
      // Midtrans requires a 200 OK response to acknowledge receipt
      return { statusCode: HttpStatus.OK, message: 'OK' };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}