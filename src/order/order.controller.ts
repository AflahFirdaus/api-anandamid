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
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { OrderCronService } from './order-cron.service';
import { ShippingLabelService } from './shipping-label.service';
import { FulfillmentService } from './fulfillment.service';
import { FulfillmentWorkflowService } from './fulfillment-workflow.service';
import { ThrottleFeature, ThrottlerFeature } from '../common/throttler';
import { PdfLabelService } from '../shipment/services/pdf-label.service';
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
    private readonly orderCronService: OrderCronService,
    private readonly shippingLabelService: ShippingLabelService,
    private readonly fulfillmentService: FulfillmentService,
    private readonly fulfillmentWorkflowService: FulfillmentWorkflowService,
    private readonly pdfLabelService: PdfLabelService,
  ) {}

  // ====================== ENDPOINT USER (PEMBELI) ======================

  @UseGuards(JwtUserGuard)
  @ThrottleFeature(ThrottlerFeature.CHECKOUT)
  @Post('checkout/cart')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Checkout from cart' })
  @ApiBody({ type: CheckoutCartDto })
  async checkoutCart(@Req() req: any, @Body() dto: CheckoutCartDto) {
    return this.orderService.checkoutFromCart(req.user.id, dto);
  }

  @UseGuards(JwtUserGuard)
  @ThrottleFeature(ThrottlerFeature.CHECKOUT)
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
  @ApiOperation({ summary: 'My orders (paginated)' })
  @ApiResponse({ status: 200, description: 'Returns paginated orders with total, page, limit, totalPages' })
  async getMyOrders(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = parseInt(page || '1', 10);
    const l = Math.min(parseInt(limit || '20', 10), 100); // max 100 per page
    return this.orderService.findMyOrders(req.user.id, p, l);
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
  @ThrottleFeature(ThrottlerFeature.CHECKOUT)
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

  // ====================== ADMIN PROCESS ORDER (START PACKING) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/process')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Process order - Start packing (Admin)',
    description:
      'Lock order, set status to DIKEMAS. This is the first step after payment. For courier booking, use search-driver (instant) or setup-shipping (regular).',
  })
  @ApiResponse({ status: 200, description: 'Order processed' })
  @ApiResponse({ status: 400, description: 'Only LUNAS orders can be processed' })
  async processOrder(
    @Param('id') orderId: string,
    @Req() req: any,
  ) {
    const adminName = req.user?.full_name || req.user?.email || 'Admin';
    return this.fulfillmentService.startPacking(orderId, adminName);
  }

  // ====================== ADMIN COMPLETE PACKING ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/complete-packing')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Complete packing (Admin)',
    description: 'Mark packing as complete. Order status becomes DIKEMAS. Ready for shipping setup.',
  })
  @ApiResponse({ status: 200, description: 'Packing completed' })
  @ApiResponse({ status: 400, description: 'Order not in packing status' })
  async completePacking(@Param('id') orderId: string, @Req() req: any) {
    const adminName = req.user?.full_name || req.user?.email || 'Admin';
    return this.fulfillmentService.completePacking(orderId, adminName);
  }

  // ====================== ADMIN SEARCH DRIVER (INSTANT) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/search-driver')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Search & book driver (Admin, Instant courier)' })
  @ApiResponse({ status: 200, description: 'Driver booked successfully' })
  @ApiResponse({ status: 400, description: 'Only DIKEMAS instant orders' })
  async searchDriver(@Param('id') orderId: string) {
    return this.fulfillmentWorkflowService.processInstantBooking(orderId);
  }

  // ====================== ADMIN SETUP SHIPPING (ATUR PENGIRIMAN) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/setup-shipping')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Setup shipping method (Admin, Regular)',
    description: 'Set handover_method to PICKUP (jemput kurir) or DROP_OFF (antar ke outlet). Required before book-shipping.'
  })
  @ApiResponse({ status: 200, description: 'Shipping setup completed' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async setupShipping(@Param('id') orderId: string, @Body() body: { handover_method: HandoverMethod }) {
    return this.fulfillmentService.setupShipping(orderId, body.handover_method);
  }

  // ====================== ADMIN BOOK SHIPPING (REGULAR) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/book-shipping')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Book regular shipping (Admin)',
    description: 'Generate AWB + create shipment + mark label READY for regular orders. Requires handover_method to be set via setup-shipping first.',
  })
  @ApiResponse({ status: 200, description: 'Shipping booked - label ready' })
  @ApiResponse({ status: 400, description: 'Handover method must be set first' })
  async bookRegularShipping(@Param('id') orderId: string) {
    return this.fulfillmentWorkflowService.processRegularBooking(orderId);
  }

  // ====================== ADMIN MARK HANDED OVER (DROP-OFF) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/handover-dropoff')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Mark as handed over (Admin, Drop-off)',
    description: 'For DROP_OFF orders: mark that package has been handed to courier outlet. Transitions to DIKIRIM.',
  })
  @ApiResponse({ status: 200, description: 'Marked as handed over' })
  @ApiResponse({ status: 400, description: 'Not DROP_FF method' })
  async markHandedOver(@Param('id') orderId: string) {
    return this.fulfillmentWorkflowService.markHandedOver(orderId);
  }

  // ====================== ADMIN REQUEST PICKUP (LEGACY COMPAT) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/request-pickup')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Request pickup via Biteship (Admin, Legacy)' })
  @ApiResponse({ status: 200, description: 'Pickup requested' })
  @ApiResponse({ status: 400, description: 'Only DIKEMAS regular orders' })
  async requestPickup(@Param('id') orderId: string) {
    return this.orderService.requestPickup(orderId);
  }

  // ====================== ADMIN MARK READY FOR PICKUP (STORE PICKUP) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/mark-ready-pickup')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Mark order ready for pickup (Admin, Store Pickup)',
    description: 'For store_pickup orders: mark that package is ready and customer can pick up. Transitions DIKEMAS → SIAP. Sends notification to customer.',
  })
  @ApiResponse({ status: 200, description: 'Order marked ready for pickup' })
  @ApiResponse({ status: 400, description: 'Not store_pickup or wrong status' })
  async markReadyForPickup(@Param('id') orderId: string) {
    return this.orderService.markReadyForPickup(orderId);
  }

  // ====================== ADMIN MARK READY FOR DELIVERY (STORE DELIVERY) ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/mark-ready-delivery')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Mark order ready for delivery (Admin, Store Delivery)',
    description: 'For store_delivery orders: mark that package is ready to be delivered by store. Transitions DIKEMAS → SIAP. Sends notification to customer.',
  })
  @ApiResponse({ status: 200, description: 'Order marked ready for delivery' })
  @ApiResponse({ status: 400, description: 'Not store_delivery or wrong status' })
  async markReadyForDelivery(@Param('id') orderId: string) {
    return this.orderService.markReadyForDelivery(orderId);
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
    // Get the active shipment for this order to generate PDF from shipment snapshot
    const shipment = await this.fulfillmentWorkflowService.getActiveShipment(orderId);
    const pdfBuffer = await this.pdfLabelService.generateShippingLabelPdf(shipment.id);
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

  // ====================== ADMIN AUTO-CANCEL PENDING ======================
  @UseGuards(JwtAuthGuard)
  @Post('auto-cancel-pending')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Auto-cancel expired PENDING orders',
    description: 'Cancel PENDING orders that have not been paid within the configured expiry time (default 24h). Restores stock. Run as cron job.',
  })
  @ApiResponse({ status: 200, description: 'Number of orders auto-cancelled' })
  async autoCancelPending() {
    const count = await this.orderCronService.autoCancelPendingOrders();
    return { message: `${count} pesanan PENDING kadaluarsa dibatalkan otomatis.`, count };
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
  @ThrottleFeature(ThrottlerFeature.CHECKOUT)
  @Post('checkout/builder')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'PC Builder checkout' })
  @ApiBody({ type: CheckoutBuilderDto })
  async checkoutBuilder(@Req() req: any, @Body() dto: CheckoutBuilderDto) {
    return this.orderService.checkoutPCBuilder(req.user.id, dto);
  }

  @UseGuards(JwtUserGuard)
  @ThrottleFeature(ThrottlerFeature.CHECKOUT)
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

  // ====================== ADMIN REPAIR ORDER ======================
  @UseGuards(JwtAuthGuard)
  @Post(':id/repair')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Repair corrupt order state (Admin)',
    description: 'Fix orders stuck in inconsistent state (e.g. fulfillment=PACKING but status=LUNAS).',
  })
  @ApiResponse({ status: 200, description: 'Order repaired' })
  async repairOrder(@Param('id') orderId: string) {
    return this.orderService.repairOrderState(orderId);
  }

  @Post('webhook/biteship')
  @ApiOperation({ summary: 'Biteship webhook for order status updates' })
  @ApiResponse({ status: 200, description: 'OK' })
  async handleBiteshipWebhook(
    @Body() payload: any,
    @Query('token') token?: string,
    @Headers('x-biteship-token') headerToken?: string,
  ) {
    try {
      // Biteship sends an empty body during verification upon installation.
      // We must accept it and respond 200 OK immediately, bypassing token check.
      if (!payload || Object.keys(payload).length === 0) {
        return { received: true, message: 'Biteship webhook active' };
      }

      const expectedToken = process.env.BITESHIP_WEBHOOK_TOKEN;
      if (expectedToken) {
        const clientToken = token || headerToken;
        if (clientToken !== expectedToken) {
          throw new UnauthorizedException('Invalid webhook token');
        }
      }

      return await this.orderService.handleBiteshipWebhook(payload);
    } catch (err: any) {
      if (err instanceof UnauthorizedException) throw err;
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }
}
