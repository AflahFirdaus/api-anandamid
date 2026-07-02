import { Controller, Post, Body, Req, UseGuards, Patch, Param, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CheckoutCartDto, CheckoutDirectDto, CheckoutBuilderDto, CreateCheckoutDto } from './dto/checkout.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { JwtUserGuard } from '../user/guards/jwt-user.guard'; 
import { JwtAuthGuard } from '../auth/guards/jwt.guards'; 

@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // ====================== ENDPOINT USER (PEMBELI) ======================

  @UseGuards(JwtUserGuard)
  @Post('checkout/cart')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Checkout from cart', description: 'Create order from selected cart items.' })
  @ApiBody({ type: CheckoutCartDto })
  @ApiResponse({ status: 200, description: 'Cart checkout successful' })
  @ApiResponse({ status: 400, description: 'Cart items not found or invalid' })
  async checkoutCart(@Req() req: any, @Body() dto: CheckoutCartDto) {
    return this.orderService.checkoutFromCart(req.user.id, dto);
  }

  @UseGuards(JwtUserGuard)
  @Post('checkout/direct')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Direct checkout', description: 'Create order for a single product (buy now).' })
  @ApiBody({ type: CheckoutDirectDto })
  @ApiResponse({ status: 200, description: 'Direct checkout successful' })
  @ApiResponse({ status: 400, description: 'Product not found or insufficient stock' })
  async checkoutDirect(@Req() req: any, @Body() dto: CheckoutDirectDto) {
    return this.orderService.checkoutDirect(req.user.id, dto);
  }

  @UseGuards(JwtUserGuard)
  @Get('my-orders')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'My orders', description: 'List all orders for the authenticated user.' })
  @ApiResponse({ status: 200, description: 'List of user orders' })
  async getMyOrders(@Req() req: any) {
    return this.orderService.findMyOrders(req.user.id);
  }

  @UseGuards(JwtUserGuard)
  @Patch(':id/cancel')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Cancel order', description: 'Cancel a PENDING order (user only).' })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  @ApiResponse({ status: 400, description: 'Only PENDING orders can be cancelled' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async cancelMyOrder(@Req() req: any, @Param('id') orderId: string) {
    return this.orderService.cancelOrderUser(req.user.id, orderId);
  }

  // ====================== ENDPOINT ADMIN ======================
  
  @UseGuards(JwtAuthGuard) 
  
  @Patch(':id/status')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update order status (Admin)', description: 'Change order status and handle stock deduction/refund.' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async updateStatus(
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderStatusDto
  ) {
    return this.orderService.updateOrderStatus(orderId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/all')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'All orders (Admin)', description: 'List all orders with optional status filter.' })
  @ApiResponse({ status: 200, description: 'Paginated list of all orders' })
  async getAllOrders(@Query() query: any) {
    return this.orderService.findAllOrders(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Order detail (Admin)', description: 'Get full order details by order ID.' })
  @ApiResponse({ status: 200, description: 'Order details' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getOrderDetail(@Param('id') id: string) {
    return this.orderService.findOneOrder(id); 
  }

  @UseGuards(JwtUserGuard)
  @Post('checkout/builder')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'PC Builder checkout', description: 'Create order for multiple PC builder components.' })
  @ApiBody({ type: CheckoutBuilderDto })
  @ApiResponse({ status: 200, description: 'PC Builder checkout successful' })
  @ApiResponse({ status: 400, description: 'Invalid components or insufficient stock' })
  async checkoutBuilder(@Req() req: any, @Body() dto: CheckoutBuilderDto) {
    return this.orderService.checkoutPCBuilder(req.user.id, dto);
  }

  // ====================== CHECKOUT + MIDTRANS PAYMENT ======================
  @UseGuards(JwtUserGuard)
  @Post('checkout')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ 
    summary: 'Create checkout + payment token', 
    description: 'Unified checkout endpoint that processes cart or direct items, creates an order, and generates a Midtrans Snap payment token. Send either `cart_ids` (for cart-based) or `direct_item` (for single product). Optionally include `shipping_cost`, `address_id`, and `notes`.' 
  })
  @ApiBody({ type: CreateCheckoutDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Checkout successful — returns order data and Midtrans payment token & redirect_url',
  })
  @ApiResponse({ status: 400, description: 'No items to process or stock insufficient' })
  @ApiResponse({ status: 404, description: 'User or product not found' })
  async createCheckout(@Req() req: any, @Body() dto: CreateCheckoutDto) {
    return this.orderService.createCheckout(req.user.id, dto);
  }
}