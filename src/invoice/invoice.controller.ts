import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { JwtUserGuard } from '../user/guards/jwt-user.guard';
import { JwtAdminGuard } from '../user/guards/jwt-admin.guard';
import type { Response } from 'express';
import * as fs from 'fs';

@Controller()
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  /**
   * Get invoice by order ID (user)
   */
  @Get('orders/:orderId/invoice')
  @UseGuards(JwtUserGuard)
  async getOrderInvoice(
    @Param('orderId') orderId: string,
    @Req() req: any,
  ) {
    const invoice = await this.invoiceService.getInvoiceByOrderId(orderId);
    return {
      success: true,
      data: invoice,
    };
  }

  /**
   * Download invoice PDF (user)
   */
  @Get('orders/:orderId/invoice/download')
  @UseGuards(JwtUserGuard)
  async downloadInvoice(
    @Param('orderId') orderId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const invoice = await this.invoiceService.getInvoiceByOrderId(orderId);
    const filePath = await this.invoiceService.getPdfPath(invoice);

    const filename = `${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }

  /**
   * Get user's invoices list
   */
  @Get('user/invoices')
  @UseGuards(JwtUserGuard)
  async getUserInvoices(@Req() req: any) {
    const invoices = await this.invoiceService.getUserInvoices(req.user.id);
    return {
      success: true,
      data: invoices,
    };
  }

  /**
   * Admin: Get all invoices
   */
  @Get('admin/invoices')
  @UseGuards(JwtAdminGuard)
  async getAllInvoices(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.invoiceService.getAllInvoices(
      page || 1,
      limit || 20,
    );
    return {
      success: true,
      ...result,
    };
  }

  /**
   * Admin: Cancel invoice
   */
  @Post('admin/invoices/:id/cancel')
  @UseGuards(JwtAdminGuard)
  async cancelInvoice(@Param('id') id: string) {
    const invoice = await this.invoiceService.cancelInvoice(id);
    return {
      success: true,
      data: invoice,
    };
  }

  /**
   * Admin: Download invoice PDF by invoice ID
   */
  @Get('admin/invoices/:id/download')
  @UseGuards(JwtAdminGuard)
  async adminDownloadInvoice(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const invoice = await this.invoiceService.getInvoiceById(id);
    const filePath = await this.invoiceService.getPdfPath(invoice);

    const filename = `${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }

  /**
   * Admin: Preview invoice PDF in browser
   */
  @Get('admin/invoices/:id/preview')
  @UseGuards(JwtAdminGuard)
  async adminPreviewInvoice(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const invoice = await this.invoiceService.getInvoiceById(id);
    const filePath = await this.invoiceService.getPdfPath(invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  }
}
