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
import {
  CheckoutCartDto,
  CheckoutDirectDto,
  CheckoutBuilderDto,
  CreateCheckoutDto,
} from './dto/checkout.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { JwtUserGuard } from '../user/guards/jwt-user.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';

@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);

  constructor(private readonly orderService: OrderService) {}

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
  @ApiOperation({ summary: 'Cancel order' })
  async cancelMyOrder(@Req() req: any, @Param('id') orderId: string) {
    return this.orderService.cancelOrderUser(req.user.id, orderId);
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
}