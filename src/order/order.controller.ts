import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  Patch,
  Param,
  Get,
  Query,
  Res,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { ShippingLabelService } from './shipping-label.service';
import { FulfillmentService } from './fulfillment.service';
import {
  CheckoutCartDto,
  CheckoutDirectDto,
  CheckoutBuilderDto,
  CreateCheckoutDto,
} from './dto/checkout.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { JwtUserGuard } from '../user/guards/jwt-user.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';
import { HandoverMethod } from './enums/handover-method.enum';

@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(
    private readonly orderService: OrderService,
    private readonly shippingLabelService: ShippingLabelService,
    private readonly fulfillmentService: FulfillmentService,
  ) {}

  // ====================== ENDPOINT USER (PEMBELI) ======================

  @UseGuards(JwtUserGuard)
  @Post('checkout/cart')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Checkout from cart' })
  @ApiBody({ type: CheckoutCartDto })
  async checkoutCart(@Req() req: any, @Body() dto: CheckoutCartDto) {
    return this.orderService.checkoutFromCart(req.user.id, dto);
  }

  @UseGuards(JwtUserGuard)
  @Post('checkout/direct')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Direct checkout' })
  @ApiBody({ type: CheckoutDirectDto })
  async checkoutDirect(@Req() req: any, @Body() dto: CheckoutDirectDto) {
    return this.orderService.checkoutDirect(req.user.id, dto);
  }

  @UseGuards(JwtUserGuard)
  @Get('my-orders')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'My orders' })
  async getMyOrders(@Req() req: any) {
    return this.orderService.findMyOrders(req.user.id);
  }

  @UseGuards(JwtUserGuard)
  @Get(':id/detail')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'User Order detail' })
  async getUserOrderDetail(@Req() req: any, @Param('id') orderId: string) {
    // Only fetch detail if order belongs to user
    const order = await this.orderService.findOneOrder(orderId);
    if (order.user_id !== req.user.id) {
      throw new HttpException('Akses ditolak', HttpStatus.FORBIDDEN);
    }
    return order;
  }

  @UseGuards(JwtUserGuard)
  @Post(':id/retry-payment')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Retry payment' })
  async retryPayment(@Req() req: any, @Param('id') orderId: string) {
    return this.orderService.retryPayment(orderId, req.user.id);
  }

  @UseGuards(JwtUserGuard)
  @Post(':id/check-payment')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Check payment status' })
  async checkPayment(@Req() req: any, @Param('id') orderId: string) {
    return this.orderService.checkPaymentStatus(orderId, req.user.id);
  }

  @UseGuards(JwtUserGuard)
  @Patch(':id/cancel')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Cancel order (only PENDING)' })
  async cancelMyOrder(@Req() req: any, @Param('id') orderId: string) {
    return this.orderService.cancelOrderUser(req.user.id, orderId);
  }

  // ====================== USER REQUEST CANCEL (PAID ORDER) ======================
  @UseGuards(JwtUserGuard)
  @Post(':id/cancel/request')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Request cancel PAID order + refund',
    description: 'User requests cancellation of a PAID/LUNAS order. Initiates Midtrans refund.'
  })
  async requestCancelOrder(
    @Req() req: any,
    @Param('id') orderId: string,
    @Body() body: { cancel_reason: string; cancel_reason_detail?: string },
  ) {
    return this.orderService.requestCancel(req.user.id, orderId, body);
  }

  @UseGuards(JwtUserGuard)
  @Get(':id/tracking')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Track order shipment' })
  async getTracking(@Req() req: any, @Param('id') orderId: string) {
    return this.orderService.getTrackingInfo(orderId, req.user.id);
  }

  // ====================== USER CONFIRM RECEIVED ======================
  @UseGuards(JwtUserGuard)
  @Patch(':id/confirm-received')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Confirm order received (Buyer)' })
  @ApiResponse({ status: 200, description: 'Order completed' })
  @ApiResponse({ status: 400, description: 'Only DIKIRIM orders can be confirmed' })
  async confirmReceived(@Req() req: any, @Param('id') orderId: string) {
    return this.orderService.confirmReceived(orderId, req.user.id);
  }

  // ====================== ENDPOINT ADMIN ======================

  @UseGuards(JwtAuthGuard)
  @Patch(':id/status')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update order status (Admin)' })
  async updateStatus(@Param('id') orderId: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orderService.updateOrderStatus(orderId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/all')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'All orders (Admin)' })
  async getAllOrders(@Query() query: any) {
    return this.orderService.findAllOrders(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Order detail (Admin)' })
  async getOrderDetail(@Param('id') id: string) {
    return this.orderService.findOneOrder(id);
  }

  // ====================== ADMIN PROCESS ORDER ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/process')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Process order (Admin)',
    description:
      'Lock order, deduct stock, generate AWB via Biteship, change status to DIKEMAS.',
  })
  @ApiResponse({ status: 200, description: 'Order processed and locked' })
  @ApiResponse({ status: 400, description: 'Only LUNAS orders can be processed' })
  async processOrder(
    @Param('id') orderId: string,
    @Body()
    body?: {
      tracking_number?: string;
      courier_name?: string;
      courier_service?: string;
    },
  ) {
    return this.orderService.processOrder(orderId, body);
  }

  // ====================== ADMIN REQUEST PICKUP (REGULAR) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/request-pickup')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Request pickup via Biteship (Admin, Regular courier)' })
  @ApiResponse({ status: 200, description: 'Pickup requested' })
  @ApiResponse({ status: 400, description: 'Only DIKEMAS regular orders' })
  async requestPickup(@Param('id') orderId: string) {
    return this.orderService.requestPickup(orderId);
  }

  // ====================== ADMIN SEARCH DRIVER (INSTANT) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/search-driver')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Search driver (Admin, Instant courier)' })
  @ApiResponse({ status: 200, description: 'Driver search result' })
  @ApiResponse({ status: 400, description: 'Only DIKEMAS instant orders' })
  async searchDriver(@Param('id') orderId: string) {
    return this.orderService.searchDriver(orderId);
  }

  // ====================== ADMIN MARK DELIVERED ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/mark-delivered')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark order as delivered (Admin)' })
  @ApiResponse({ status: 200, description: 'Order marked as DIKIRIM' })
  @ApiResponse({ status: 400, description: 'Only DIKEMAS orders' })
  async markDelivered(@Param('id') orderId: string) {
    return this.orderService.markDelivered(orderId);
  }

  // ====================== ADMIN SHIPPING LABEL DATA (JSON) ======================
  @UseGuards(JwtAuthGuard)
  @Get(':id/shipping-label')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Get shipping label data (Admin)',
    description: 'Returns all data needed to generate a professional shipping label including barcode, QR code, sender/recipient info, courier, items, etc.'
  })
  @ApiResponse({ status: 200, description: 'Shipping label data' })
  @ApiResponse({ status: 400, description: 'AWB not available' })
  async getShippingLabel(@Param('id') orderId: string) {
    return this.orderService.findShippingLabelData(orderId);
  }

  // ====================== ADMIN SHIPPING LABEL PDF ======================
  @UseGuards(JwtAuthGuard)
  @Get(':id/shipping-label.pdf')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Download shipping label PDF (Admin)',
    description: 'Returns a PDF file ready for thermal printing (100x150mm). Download only - does NOT increment print_count.'
  })
  @ApiResponse({ status: 200, description: 'PDF file' })
  @ApiResponse({ status: 400, description: 'AWB or snapshot not available' })
  async downloadShippingLabelPdf(
    @Param('id') orderId: string,
    @Res() res: any,
  ) {
    const pdfBuffer = await this.shippingLabelService.generateShippingLabelPdf(orderId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="shipping-label-${orderId.substring(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  // ====================== ADMIN MARK LABEL PRINTED ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/mark-label-printed')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Mark shipping label as printed (Admin)',
    description: 'Increments label_print_count, updates label_status to PRINTED/REPRINTED, records printed_by and printed_at. Call this when admin actually prints the label.'
  })
  @ApiResponse({ status: 200, description: 'Label marked as printed' })
  @ApiResponse({ status: 400, description: 'AWB not available' })
  async markLabelPrinted(
    @Param('id') orderId: string,
    @Req() req: any,
  ) {
    const adminName = req.user?.full_name || req.user?.email || 'Admin';
    await this.shippingLabelService.markLabelPrinted(orderId, adminName);
    return { message: 'Label ditandai sebagai sudah dicetak.' };
  }

  // ====================== ADMIN PACKING SLIP PDF ======================
  @UseGuards(JwtAuthGuard)
  @Get(':id/packing-slip.pdf')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Download packing slip PDF (Admin)',
    description: 'Returns an A4 PDF packing slip for warehouse use. Includes invoice, customer info, items list with variants, quantities, prices, and order barcode.'
  })
  @ApiResponse({ status: 200, description: 'PDF file' })
  async downloadPackingSlipPdf(
    @Param('id') orderId: string,
    @Res() res: any,
  ) {
    const pdfBuffer = await this.shippingLabelService.generatePackingSlipPdf(orderId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="packing-slip-${orderId.substring(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  // ====================== ADMIN PRINT AWB LABEL ======================
  @UseGuards(JwtAuthGuard)
  @Get(':id/label')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Print / get AWB shipping label URL (Admin)' })
  async printAwbLabel(@Param('id') orderId: string) {
    const order = await this.orderService.findOneOrder(orderId);
    if (!order.awb_url) {
      throw new HttpException('Label AWB belum tersedia untuk pesanan ini', HttpStatus.BAD_REQUEST);
    }
    return { awb_url: order.awb_url };
  }

  // ====================== ADMIN AUTO-COMPLETE ======================
  @UseGuards(JwtAuthGuard)
  @Post('auto-complete')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Auto-complete delivered orders',
    description: 'Complete orders delivered > 2x24 hours ago. Run as cron job.',
  })
  @ApiResponse({ status: 200, description: 'Number of orders auto-completed' })
  async autoComplete() {
    const count = await this.orderService.autoCompleteOrders();
    return { message: `${count} pesanan diselesaikan otomatis.`, count };
  }

  // ====================== BUILDER & CHECKOUT PAYMENT ======================

  @UseGuards(JwtUserGuard)
  @Post('checkout/builder')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'PC Builder checkout' })
  @ApiBody({ type: CheckoutBuilderDto })
  async checkoutBuilder(@Req() req: any, @Body() dto: CheckoutBuilderDto) {
    return this.orderService.checkoutPCBuilder(req.user.id, dto);
  }

  @UseGuards(JwtUserGuard)
  @Post('checkout')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create checkout + payment token',
    description:
      'Unified checkout endpoint that processes cart or direct items, creates an order, and generates a Midtrans Snap payment token.',
  })
  @ApiBody({ type: CreateCheckoutDto })
  @ApiResponse({
    status: 200,
    description: 'Checkout successful — returns order data and Midtrans payment token & redirect_url',
  })
  async createCheckout(@Req() req: any, @Body() dto: CreateCheckoutDto) {
    return this.orderService.createCheckout(req.user.id, dto);
  }

  // ====================== FULFILLMENT: START PACKING ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/fulfillment/start-packing')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Start packing (Admin)',
    description: 'Transition fulfillment to PACKING. Only for LUNAS orders.',
  })
  @ApiResponse({ status: 200, description: 'Packing started' })
  @ApiResponse({ status: 400, description: 'Only LUNAS orders can be packed' })
  async startPacking(@Param('id') orderId: string, @Req() req: any) {
    const adminName = req.user?.full_name || req.user?.email || 'Admin';
    return this.fulfillmentService.startPacking(orderId, adminName);
  }

  // ====================== FULFILLMENT: COMPLETE PACKING (REGULAR) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/fulfillment/complete-packing')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Complete packing (Admin, Regular)',
    description: 'Transition fulfillment to READY_TO_SHIP. Only for regular orders after packing.',
  })
  @ApiResponse({ status: 200, description: 'Packing completed' })
  @ApiResponse({ status: 400, description: 'Order not in packing status' })
  async completePacking(@Param('id') orderId: string, @Req() req: any) {
    const adminName = req.user?.full_name || req.user?.email || 'Admin';
    return this.fulfillmentService.completePacking(orderId, adminName);
  }

  // ====================== FULFILLMENT: SETUP SHIPPING ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/fulfillment/setup-shipping')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Setup shipping (Admin, Regular)',
    description: 'Choose handover method: PICKUP or DROP_OFF. Only for regular orders.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        handover_method: {
          type: 'string',
          enum: ['PICKUP', 'DROP_OFF'],
          example: 'PICKUP',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Shipping setup completed' })
  @ApiResponse({ status: 400, description: 'Invalid handover method' })
  async setupShipping(
    @Param('id') orderId: string,
    @Body() body: { handover_method: HandoverMethod },
    @Req() req: any,
  ) {
    const adminName = req.user?.full_name || req.user?.email || 'Admin';
    return this.fulfillmentService.setupShipping(orderId, body.handover_method, adminName);
  }

  // ====================== FULFILLMENT: GET STATUS ======================
  @UseGuards(JwtAuthGuard)
  @Get(':id/fulfillment/status')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get fulfillment status (Admin)',
    description: 'Returns internal fulfillment status, shipping method, handover method, and label readiness.',
  })
  @ApiResponse({ status: 200, description: 'Fulfillment status' })
  async getFulfillmentStatus(@Param('id') orderId: string) {
    return this.fulfillmentService.getFulfillmentStatus(orderId);
  }

  // ====================== FULFILLMENT: CANCEL ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/fulfillment/cancel')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Cancel fulfillment (Admin)',
    description: 'Cancel fulfillment and unlock order. Only from PACKING, READY_TO_SHIP, or SHIPPING_SETUP.',
  })
  @ApiResponse({ status: 200, description: 'Fulfillment cancelled' })
  @ApiResponse({ status: 400, description: 'Cannot cancel at this stage' })
  async cancelFulfillment(@Param('id') orderId: string, @Req() req: any) {
    const adminName = req.user?.full_name || req.user?.email || 'Admin';
    return this.fulfillmentService.cancelFulfillment(orderId, adminName);
  }

  // ====================== BITESHIP WEBHOOK ======================
  @Post('webhook/biteship')
  @ApiOperation({ summary: 'Biteship webhook for order status updates' })
  @ApiResponse({ status: 200, description: 'OK' })
  async handleBiteshipWebhook(@Body() payload: any) {
    try {
      return await this.orderService.handleBiteshipWebhook(payload);
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }
}
