import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { Order } from '../order/entities/order.entity';
import * as path from 'path';
import * as fs from 'fs';

// pdfmake - use require for type compatibility
const PdfPrinter = require('pdfmake');

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  private readonly invoiceDir: string;

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly dataSource: DataSource,
  ) {
    this.invoiceDir = path.join(process.cwd(), 'uploads', 'invoices');
    if (!fs.existsSync(this.invoiceDir)) {
      fs.mkdirSync(this.invoiceDir, { recursive: true });
    }
  }

  /**
   * Generate invoice number: INV/YYYYMM/XXXXX
   */
  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `INV/${yearMonth}/`;

    // Find the last invoice number for this month
    const lastInvoice = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.invoice_number LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('invoice.invoice_number', 'DESC')
      .getOne();

    let nextSeq = 1;
    if (lastInvoice) {
      const lastNum = parseInt(lastInvoice.invoice_number.split('/').pop() || '0', 10);
      nextSeq = lastNum + 1;
    }

    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  }

  /**
   * Generate PDF invoice for a given order.
   * Called when order status changes to DIKIRIM.
   */
  async generateInvoice(orderId: string): Promise<Invoice> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product'],
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} tidak ditemukan`);
    }

    // Check if invoice already exists
    const existing = await this.invoiceRepo.findOne({ where: { order_id: orderId } });
    if (existing) {
      this.logger.warn(`Invoice already exists for order ${orderId}, skipping`);
      return existing;
    }

    const invoiceNumber = await this.generateInvoiceNumber();

    // Calculate values
    const subtotalItems = order.items?.reduce(
      (sum, item) => sum + Number(item.price) * item.quantity,
      0,
    ) || 0;
    const shippingCost = Number(order.shipping_cost) || 0;
    const discount = Math.max(0, subtotalItems + shippingCost - Number(order.total_price));
    const total = Number(order.total_price) || 0;

    // Tax invoice data
    const taxRequest = (order as any).tax_invoice_request || null;
    const isTaxInvoice = (order as any).is_tax_invoice_requested || false;

    // Build items snapshot
    const itemsSnapshot = order.items?.map((item) => ({
      product_name: item.product_name,
      variasi: item.variasi || null,
      quantity: item.quantity,
      price: Number(item.price),
      subtotal: Number(item.price) * item.quantity,
    })) || [];

    // Customer data from shipping_address_snapshot
    const addr = order.shipping_address_snapshot || {};

    // Create invoice record
    const invoice = this.invoiceRepo.create({
      order_id: orderId,
      invoice_number: invoiceNumber,
      invoice_type: isTaxInvoice ? 'TAX' : 'PROFORMA',
      customer_name: addr.recipient_name || '',
      customer_address: addr.full_address || '',
      customer_npwp: isTaxInvoice ? taxRequest?.npwp_number || null : null,
      company_name: isTaxInvoice ? taxRequest?.company_name || null : null,
      company_address: isTaxInvoice ? taxRequest?.company_address || null : null,
      company_email: isTaxInvoice ? taxRequest?.company_email || null : null,
      items: itemsSnapshot,
      subtotal: subtotalItems,
      shipping_cost: shippingCost,
      discount: discount,
      ppn: 0,
      total: total,
      payment_method: order.payment_method || '',
      status: 'ISSUED',
      generated_at: new Date(),
      issued_at: new Date(),
    });

    const savedInvoice = await this.invoiceRepo.save(invoice);

    // Generate PDF
    try {
      const pdfUrl = await this.generatePdf(savedInvoice, order);
      savedInvoice.pdf_url = pdfUrl;
      await this.invoiceRepo.save(savedInvoice);
    } catch (err) {
      this.logger.error(`Failed to generate PDF for invoice ${invoiceNumber}: ${err.message}`);
      // Invoice record still created, just without PDF
    }

    return savedInvoice;
  }

  /**
   * Generate PDF file for invoice
   */
  private async generatePdf(invoice: Invoice, order: Order): Promise<string> {
    const fonts = {
      Roboto: {
        normal: path.join(process.cwd(), 'node_modules', 'pdfmake', 'build', 'fonts', 'Roboto-Regular.ttf'),
        bold: path.join(process.cwd(), 'node_modules', 'pdfmake', 'build', 'fonts', 'Roboto-Medium.ttf'),
        italics: path.join(process.cwd(), 'node_modules', 'pdfmake', 'build', 'fonts', 'Roboto-Italic.ttf'),
        bolditalics: path.join(process.cwd(), 'node_modules', 'pdfmake', 'build', 'fonts', 'Roboto-MediumItalic.ttf'),
      },
    };

    const printer = new PdfPrinter(fonts);

    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    // Build table body for items
    const tableBody: any[][] = [
      [
        { text: 'No', style: 'tableHeader', alignment: 'center' },
        { text: 'Produk', style: 'tableHeader' },
        { text: 'Varian', style: 'tableHeader', alignment: 'center' },
        { text: 'Qty', style: 'tableHeader', alignment: 'center' },
        { text: 'Harga', style: 'tableHeader', alignment: 'right' },
        { text: 'Subtotal', style: 'tableHeader', alignment: 'right' },
      ],
    ];

    invoice.items?.forEach((item: any, idx: number) => {
      tableBody.push([
        { text: String(idx + 1), alignment: 'center', fontSize: 9 },
        { text: item.product_name || '-', fontSize: 9 },
        { text: item.variasi || '-', alignment: 'center', fontSize: 9 },
        { text: String(item.quantity), alignment: 'center', fontSize: 9 },
        { text: `Rp ${Number(item.price).toLocaleString('id-ID')}`, alignment: 'right', fontSize: 9 },
        { text: `Rp ${Number(item.subtotal).toLocaleString('id-ID')}`, alignment: 'right', fontSize: 9 },
      ]);
    });

    // Build document definition
    const docDefinition: any = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 40],
      content: [
        // ── HEADER ──
        {
          columns: [
            {
              text: 'ANANDAM COMPUTER',
              style: 'companyName',
              width: '*',
            },
            {
              text: 'INVOICE',
              style: 'invoiceTitle',
              alignment: 'right',
            },
          ],
        },
        {
          text: 'Jl. Affandi No.17, Soropadan, Condongcatur, Kec. Depok, Kabupaten Sleman, Yogyakarta 55283',
          style: 'companyAddress',
          margin: [0, 2, 0, 0],
        },
        {
          text: `Telp: 081228134747 | Email: anandam.computer@gmail.com`,
          style: 'companyContact',
          margin: [0, 0, 0, 10],
        },
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#1a73e8' },
          ],
          margin: [0, 0, 0, 10],
        },

        // ── INVOICE INFO ──
        {
          columns: [
            {
              width: '50%',
              stack: [
                { text: `No. Invoice: ${invoice.invoice_number}`, style: 'infoText' },
                { text: `Tanggal: ${dateStr}`, style: 'infoText' },
                { text: `Status: ${invoice.status === 'ISSUED' ? 'Telah Terbit' : invoice.status}`, style: 'infoText' },
              ],
            },
            {
              width: '50%',
              stack: [
                { text: `Pembayaran: ${invoice.payment_method || '-'}`, style: 'infoText', alignment: 'right' },
              ],
            },
          ],
          margin: [0, 0, 0, 15],
        },

        // ── CUSTOMER INFO ──
        {
          text: 'DATA PEMBELI',
          style: 'sectionTitle',
        },
        {
          columns: [
            {
              width: '50%',
              stack: [
                { text: `Nama: ${invoice.customer_name || '-'}`, style: 'dataText' },
                { text: `Alamat: ${invoice.customer_address || '-'}`, style: 'dataText' },
              ],
            },
          ],
          margin: [0, 5, 0, 15],
        },

        // ── ORDER ITEMS TABLE ──
        {
          text: 'DETAIL PESANAN',
          style: 'sectionTitle',
        },
        {
          table: {
            headerRows: 1,
            widths: [25, '*', 60, 35, 70, 80],
            body: tableBody,
          },
          layout: {
            hLineWidth: (i: number) => (i === 0 || i === 1 ? 1 : 0.5),
            vLineWidth: () => 0.5,
            hLineColor: () => '#cccccc',
            vLineColor: () => '#cccccc',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 5,
            paddingBottom: () => 5,
          },
          margin: [0, 5, 0, 15],
        },

        // ── PAYMENT SUMMARY ──
        {
          text: 'RINGKASAN PEMBAYARAN',
          style: 'sectionTitle',
        },
        {
          layout: 'noBorders',
          table: {
            widths: ['*', 120],
            body: [
              [
                { text: 'Subtotal', style: 'summaryLabel' },
                { text: `Rp ${Number(invoice.subtotal).toLocaleString('id-ID')}`, style: 'summaryValue', alignment: 'right' },
              ],
              [
                { text: 'Ongkos Kirim', style: 'summaryLabel' },
                { text: `Rp ${Number(invoice.shipping_cost).toLocaleString('id-ID')}`, style: 'summaryValue', alignment: 'right' },
              ],
              ...(Number(invoice.discount) > 0
                ? [
                    [
                      { text: 'Diskon', style: 'summaryLabel' },
                      { text: `-Rp ${Number(invoice.discount).toLocaleString('id-ID')}`, style: 'summaryDiscount', alignment: 'right' },
                    ],
                  ]
                : []),
              [
                { text: '', height: 5 },
                { text: '', height: 5 },
              ],
              [
                { text: 'TOTAL', style: 'totalLabel' },
                { text: `Rp ${Number(invoice.total).toLocaleString('id-ID')}`, style: 'totalValue', alignment: 'right' },
              ],
            ],
          },
          margin: [0, 5, 0, 20],
        },

        // ── TAX INVOICE SECTION (if requested) ──
        ...(invoice.invoice_type === 'TAX'
          ? [
              {
                canvas: [
                  { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: '#000000' },
                ],
                margin: [0, 0, 0, 10],
              },
              {
                text: 'FAKTUR PAJAK',
                style: 'taxTitle',
                alignment: 'center',
                margin: [0, 0, 0, 10],
              },
              {
                layout: 'noBorders',
                table: {
                  widths: [150, '*'],
                  body: [
                    [
                      { text: 'Nama Perusahaan', style: 'taxLabel' },
                      { text: invoice.company_name || '-', style: 'taxValue' },
                    ],
                    [
                      { text: 'NPWP', style: 'taxLabel' },
                      { text: invoice.customer_npwp || '-', style: 'taxValue' },
                    ],
                    [
                      { text: 'Email Perusahaan', style: 'taxLabel' },
                      { text: invoice.company_email || '-', style: 'taxValue' },
                    ],
                    [
                      { text: 'Alamat Perusahaan', style: 'taxLabel' },
                      { text: invoice.company_address || '-', style: 'taxValue' },
                    ],
                  ],
                },
                margin: [0, 0, 0, 20],
              },
            ]
          : []),

        // ── FOOTER ──
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#cccccc' },
          ],
          margin: [0, 0, 0, 10],
        },
        {
          text: 'Terima kasih telah berbelanja di Anandam Computer',
          style: 'footerText',
          alignment: 'center',
        },
        {
          text: 'Barang yang sudah dibeli tidak dapat dikembalikan kecuali ada kerusakan atau kesalahan dari pihak toko.',
          style: 'footerSmall',
          alignment: 'center',
          margin: [0, 3, 0, 0],
        },
      ],

      styles: {
        companyName: {
          fontSize: 18,
          bold: true,
          color: '#1a73e8',
        },
        companyAddress: {
          fontSize: 8,
          color: '#666666',
        },
        companyContact: {
          fontSize: 8,
          color: '#666666',
        },
        invoiceTitle: {
          fontSize: 24,
          bold: true,
          color: '#333333',
        },
        sectionTitle: {
          fontSize: 10,
          bold: true,
          color: '#1a73e8',
          margin: [0, 0, 0, 5],
        },
        infoText: {
          fontSize: 9,
          color: '#333333',
          margin: [0, 1, 0, 1],
        },
        dataText: {
          fontSize: 9,
          color: '#333333',
          margin: [0, 1, 0, 1],
        },
        tableHeader: {
          fontSize: 9,
          bold: true,
          color: '#ffffff',
          fillColor: '#1a73e8',
        },
        summaryLabel: {
          fontSize: 9,
          color: '#666666',
        },
        summaryValue: {
          fontSize: 9,
          color: '#333333',
          bold: true,
        },
        summaryDiscount: {
          fontSize: 9,
          color: '#e53935',
          bold: true,
        },
        totalLabel: {
          fontSize: 12,
          bold: true,
          color: '#333333',
        },
        totalValue: {
          fontSize: 14,
          bold: true,
          color: '#1a73e8',
        },
        taxTitle: {
          fontSize: 16,
          bold: true,
          color: '#333333',
        },
        taxLabel: {
          fontSize: 9,
          bold: true,
          color: '#333333',
          margin: [0, 2, 0, 2],
        },
        taxValue: {
          fontSize: 9,
          color: '#333333',
          margin: [0, 2, 0, 2],
        },
        footerText: {
          fontSize: 9,
          color: '#666666',
          italics: true,
        },
        footerSmall: {
          fontSize: 7,
          color: '#999999',
        },
      },
    };

    const filename = `${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
    const filePath = path.join(this.invoiceDir, filename);

    return new Promise<string>((resolve, reject) => {
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const writeStream = fs.createWriteStream(filePath);
      pdfDoc.pipe(writeStream);
      pdfDoc.end();

      writeStream.on('finish', () => {
        const relativePath = `/uploads/invoices/${filename}`;
        resolve(relativePath);
      });

      writeStream.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Get invoice by order ID
   */
  async getInvoiceByOrderId(orderId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({ where: { order_id: orderId } });
    if (!invoice) {
      throw new NotFoundException('Invoice belum tersedia untuk pesanan ini');
    }
    return invoice;
  }

  /**
   * Get invoice by ID
   */
  async getInvoiceById(id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException('Invoice tidak ditemukan');
    }
    return invoice;
  }

  /**
   * Get all invoices for a user (by their orders)
   */
  async getUserInvoices(userId: string): Promise<Invoice[]> {
    return this.invoiceRepo.find({
      where: { order: { user_id: userId } as any },
      relations: ['order'],
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Get all invoices (admin)
   */
  async getAllInvoices(page = 1, limit = 20): Promise<{ data: Invoice[]; total: number }> {
    const [data, total] = await this.invoiceRepo.findAndCount({
      relations: ['order'],
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  /**
   * Cancel invoice
   */
  async cancelInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await this.getInvoiceById(invoiceId);
    if (invoice.status === 'CANCELLED') {
      throw new BadRequestException('Invoice sudah dibatalkan sebelumnya');
    }
    invoice.status = 'CANCELLED';
    invoice.cancelled_at = new Date();
    return this.invoiceRepo.save(invoice);
  }

  /**
   * Get PDF file path
   */
  getPdfPath(invoice: Invoice): string {
    if (!invoice.pdf_url) {
      throw new NotFoundException('File PDF invoice belum tersedia');
    }
    return path.join(process.cwd(), invoice.pdf_url);
  }
}