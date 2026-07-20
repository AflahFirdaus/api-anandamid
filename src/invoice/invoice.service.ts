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
import PDFDocument from 'pdfkit';

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

  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prefix = `INV/${yearMonth}/`;
    const lastInvoice = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .where('invoice.invoice_number LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('invoice.invoice_number', 'DESC')
      .getOne();
    let nextSeq = 1;
    if (lastInvoice) {
      const lastNum = parseInt(
        lastInvoice.invoice_number.split('/').pop() || '0',
        10,
      );
      nextSeq = lastNum + 1;
    }
    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  }

  async generateInvoice(orderId: string): Promise<Invoice> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product'],
    });
    if (!order) throw new NotFoundException(`Order ${orderId} tidak ditemukan`);

    const existing = await this.invoiceRepo.findOne({
      where: { order_id: orderId },
    });
    if (existing) {
      this.logger.warn(`Invoice already exists for order ${orderId}, skipping`);
      return existing;
    }

    const invoiceNumber = await this.generateInvoiceNumber();
    const subtotalItems =
      order.items?.reduce(
        (sum, item) => sum + Number(item.price) * item.quantity,
        0,
      ) || 0;
    const shippingCost = Number(order.shipping_cost) || 0;
    const discount = Math.max(
      0,
      subtotalItems + shippingCost - Number(order.total_price),
    );
    const total = Number(order.total_price) || 0;

    const taxRequest = (order as any).tax_invoice_request || null;
    const isTaxInvoice = (order as any).is_tax_invoice_requested || false;

    const itemsSnapshot =
      order.items?.map((item) => ({
        product_name: item.product_name,
        variasi: item.variasi || null,
        quantity: item.quantity,
        price: Number(item.price),
        subtotal: Number(item.price) * item.quantity,
      })) || [];

    const addr = order.shipping_address_snapshot || {};

    const invoice = this.invoiceRepo.create({
      order_id: orderId,
      invoice_number: invoiceNumber,
      invoice_type: isTaxInvoice ? 'TAX' : 'PROFORMA',
      customer_name: addr.recipient_name || '',
      customer_address: addr.full_address || '',
      customer_npwp: isTaxInvoice ? taxRequest?.npwp_number || null : null,
      company_name: isTaxInvoice ? taxRequest?.company_name || null : null,
      company_address: isTaxInvoice
        ? taxRequest?.company_address || null
        : null,
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

    try {
      const pdfUrl = await this.generatePdf(savedInvoice, order);
      savedInvoice.pdf_url = pdfUrl;
      await this.invoiceRepo.save(savedInvoice);
    } catch (err: any) {
      this.logger.error(
        `Failed to generate PDF for invoice ${invoiceNumber}: ${err.message}`,
      );
    }

    return savedInvoice;
  }

  private generatePdf(invoice: Invoice, _order: Order): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      try {
        const filename = `${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
        const filePath = path.join(this.invoiceDir, filename);

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const W = doc.page.width - 80; // usable width (margin 40 each side)
        const blue = '#1a73e8';
        const darkGray = '#333333';
        const midGray = '#666666';
        const lightGray = '#cccccc';

        const rupiah = (n: number) =>
          'Rp ' + Number(n).toLocaleString('id-ID');

        // ── HEADER BLOCK ────────────────────────────────────────────
        doc.rect(40, 40, W, 70).fill(blue);

        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(18)
          .text('ANANDAM COMPUTER', 52, 52);

        doc
          .font('Helvetica')
          .fontSize(8)
          .text(
            'Jl. Manggis No.7, Karangasem, Kec. Laweyan, Kota Surakarta',
            52,
            74,
          )
          .text('Telp: +62 851-5773-4848 | Email: anandamcomputer@gmail.com', 52, 85);

        // Invoice label on the right
        doc
          .font('Helvetica-Bold')
          .fontSize(22)
          .text('E-INVOICE', 40, 50, { align: 'right', width: W });

        doc
          .font('Helvetica')
          .fontSize(9)
          .text(invoice.invoice_number, 40, 76, { align: 'right', width: W })
          .text(
            invoice.invoice_type === 'TAX' ? 'FAKTUR PAJAK' : 'PROFORMA INVOICE',
            40,
            88,
            { align: 'right', width: W },
          );

        // ── INFO BOX ────────────────────────────────────────────────
        let y = 125;
        doc.rect(40, y, W, 70).fill('#f1f5f9');

        const issuedDate = new Date(
          invoice.issued_at || invoice.created_at,
        ).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });

        const col1 = 52;
        const col2 = 40 + W / 2 + 10;
        const labelOpts = { width: W / 2 - 20 };

        // Column 1
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(midGray);
        doc.text('TANGGAL TERBIT', col1, y + 8, labelOpts);
        doc.font('Helvetica').fontSize(8.5).fillColor(darkGray);
        doc.text(issuedDate, col1, y + 18, labelOpts);

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(midGray);
        doc.text('STATUS', col1, y + 35, labelOpts);
        doc.font('Helvetica').fontSize(8.5).fillColor(darkGray);
        doc.text(invoice.status || 'ISSUED', col1, y + 45, labelOpts);

        // Column 2
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(midGray);
        doc.text('PELANGGAN', col2, y + 8, labelOpts);
        doc.font('Helvetica').fontSize(8.5).fillColor(darkGray);
        doc.text(invoice.customer_name || '-', col2, y + 18, labelOpts);

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(midGray);
        doc.text('METODE PEMBAYARAN', col2, y + 35, labelOpts);
        doc.font('Helvetica').fontSize(8.5).fillColor(darkGray);
        doc.text(invoice.payment_method || '-', col2, y + 45, labelOpts);

        // Alamat below
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(midGray);
        doc.text('ALAMAT PENGIRIMAN', col1, y + 55, labelOpts);
        doc.font('Helvetica').fontSize(7.5).fillColor(darkGray);
        doc.text(invoice.customer_address || '-', col1, y + 65, {
          width: W - 20,
          lineBreak: true,
          ellipsis: true,
          height: 20,
        });

        y += 85;

        // ── TABLE HEADER ─────────────────────────────────────────────
        y += 10;
        const cols = {
          no: { x: 40, w: 24 },
          product: { x: 64, w: 220 },
          qty: { x: 284, w: 40 },
          price: { x: 324, w: 90 },
          subtotal: { x: 414, w: 66 },
        };

        doc.rect(40, y, W, 18).fill(blue);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);

        doc.text('No', cols.no.x + 2, y + 4, { width: cols.no.w, align: 'center' });
        doc.text('Produk', cols.product.x + 4, y + 4, { width: cols.product.w });
        doc.text('Qty', cols.qty.x + 2, y + 4, { width: cols.qty.w, align: 'center' });
        doc.text('Harga', cols.price.x + 2, y + 4, { width: cols.price.w, align: 'right' });
        doc.text('Subtotal', cols.subtotal.x + 2, y + 4, { width: cols.subtotal.w, align: 'right' });

        y += 18;

        // ── TABLE ROWS ───────────────────────────────────────────────
        (invoice.items || []).forEach((item: any, i: number) => {
          const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
          const rowH = 22;

          doc.rect(40, y, W, rowH).fill(rowBg);
          doc
            .strokeColor(lightGray)
            .lineWidth(0.3)
            .rect(40, y, W, rowH)
            .stroke();

          doc.fillColor(darkGray).font('Helvetica').fontSize(8);
          doc.text(String(i + 1), cols.no.x + 2, y + 6, {
            width: cols.no.w,
            align: 'center',
          });
          const label = item.variasi
            ? `${item.product_name} (${item.variasi})`
            : item.product_name;
          doc.text(label, cols.product.x + 4, y + 6, {
            width: cols.product.w - 6,
            lineBreak: false,
            ellipsis: true,
          });
          doc.text(String(item.quantity), cols.qty.x + 2, y + 6, {
            width: cols.qty.w,
            align: 'center',
          });
          doc.text(rupiah(item.price), cols.price.x + 2, y + 6, {
            width: cols.price.w,
            align: 'right',
          });
          doc.text(rupiah(item.subtotal), cols.subtotal.x + 2, y + 6, {
            width: cols.subtotal.w,
            align: 'right',
          });

          y += rowH;
        });

        // ── SUMMARY ──────────────────────────────────────────────────
        y += 10;
        const sumX = 40 + W - 200;
        const sumW = 200;

        doc.rect(sumX, y, sumW, 10).fill('#f8fafc');

        const drawSummaryRow = (
          label: string,
          value: string,
          bold = false,
          color = darkGray,
        ) => {
          doc
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(bold ? 10 : 8.5)
            .fillColor(color);
          doc.text(label, sumX + 6, y + 3, { width: 100 });
          doc.text(value, sumX + 106, y + 3, { width: 88, align: 'right' });
          y += bold ? 16 : 13;
        };

        drawSummaryRow('Subtotal', rupiah(invoice.subtotal));
        drawSummaryRow('Ongkos Kirim', rupiah(invoice.shipping_cost));
        if (Number(invoice.discount) > 0) {
          drawSummaryRow('Diskon', `- ${rupiah(invoice.discount)}`, false, '#e53935');
        }
        if (Number(invoice.ppn) > 0) {
          drawSummaryRow('PPN 11%', rupiah(invoice.ppn));
        }

        // Total divider
        doc.strokeColor(blue).lineWidth(0.8).moveTo(sumX, y).lineTo(sumX + sumW, y).stroke();
        y += 5;
        drawSummaryRow('TOTAL', rupiah(invoice.total), true, blue);

        // ── FAKTUR PAJAK ─────────────────────────────────────────────
        if (invoice.invoice_type === 'TAX' && invoice.company_name) {
          y += 10;
          doc.rect(40, y, W, 60).fill('#fffbeb').stroke('#f59e0b');
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#92400e');
          doc.text('DATA FAKTUR PAJAK', 52, y + 8);
          doc.font('Helvetica').fontSize(8).fillColor('#5c2808');
          doc.text(`Perusahaan  : ${invoice.company_name}`, 52, y + 20);
          doc.text(
            `Alamat        : ${invoice.company_address || '-'}`,
            52,
            y + 32,
          );
          if (invoice.customer_npwp) {
            doc.text(
              `NPWP          : ${invoice.customer_npwp}`,
              40 + W / 2,
              y + 20,
            );
          }
          if (invoice.company_email) {
            doc.text(
              `Email            : ${invoice.company_email}`,
              40 + W / 2,
              y + 32,
            );
          }
          y += 70;
        }

        // ── FOOTER ───────────────────────────────────────────────────
        const pageH = doc.page.height;
        doc
          .font('Helvetica-Oblique')
          .fontSize(7)
          .fillColor(lightGray)
          .text(
            'Dokumen ini digenerate secara otomatis dan sah tanpa tanda tangan. | anandamcomputer.com',
            40,
            pageH - 40,
            { align: 'center', width: W },
          );

        doc.end();

        stream.on('finish', () => {
          const relativePath = `/uploads/invoices/${filename}`;
          resolve(relativePath);
        });
        stream.on('error', reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  async getInvoiceByOrderId(orderId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { order_id: orderId },
    });
    if (!invoice)
      throw new NotFoundException('Invoice belum tersedia untuk pesanan ini');
    return invoice;
  }

  async getInvoiceById(id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice tidak ditemukan');
    return invoice;
  }

  async getUserInvoices(userId: string): Promise<Invoice[]> {
    return this.invoiceRepo.find({
      where: { order: { user_id: userId } as any },
      relations: ['order'],
      order: { created_at: 'DESC' },
    });
  }

  async getAllInvoices(
    page = 1,
    limit = 20,
  ): Promise<{ data: Invoice[]; total: number }> {
    const [data, total] = await this.invoiceRepo.findAndCount({
      relations: ['order'],
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  async cancelInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = await this.getInvoiceById(invoiceId);
    if (invoice.status === 'CANCELLED')
      throw new BadRequestException('Invoice sudah dibatalkan sebelumnya');
    invoice.status = 'CANCELLED';
    invoice.cancelled_at = new Date();
    return this.invoiceRepo.save(invoice);
  }

  getPdfPath(invoice: Invoice): string {
    if (!invoice.pdf_url)
      throw new NotFoundException('File PDF invoice belum tersedia');
    return path.join(process.cwd(), invoice.pdf_url);
  }
}
