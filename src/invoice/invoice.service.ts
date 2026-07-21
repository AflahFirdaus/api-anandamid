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

    const courierParts = (order.courier_name || '').split(' - ');
    const courierName = courierParts[0] || order.courier_name || '';
    const courierService = courierParts[1] || order.courier_service || '';

    const invoice = this.invoiceRepo.create({
      order_id: orderId,
      invoice_number: invoiceNumber,
      invoice_type: isTaxInvoice ? 'TAX' : 'PROFORMA',
      customer_name: addr.recipient_name || '',
      customer_address: addr.full_address || '',
      customer_email: addr.email || addr.recipient_email || null,
      customer_phone: addr.phone_number || addr.recipient_phone || null,
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
      courier_name: courierName || null,
      courier_service: courierService || null,
      tracking_number: order.awb_number || order.tracking_number || null,
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
        const blue = '#0032B2';
        const darkGray = '#1e293b';
        const midGray = '#64748b';
        const lightGray = '#e2e8f0';

        const rupiah = (n: number) =>
          'Rp ' + Number(n).toLocaleString('id-ID');

        const formatDate = (d: Date | string) =>
          new Date(d).toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          });

        // ── ALL WHITE BACKGROUND ────────────────────────────────────
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');

        // ── HEADER: LOGO + TITLE ────────────────────────────────────
        let y = 40;

        // Try to draw the logo from the SVG file (PDFKit supports SVG natively)
        const logoPath = path.join(process.cwd(), 'public', 'anandam-logo-blue.svg');
        if (fs.existsSync(logoPath)) {
          try {
            doc.image(logoPath, 40, y, { width: 55 });
          } catch {
            doc.font('Helvetica-Bold').fontSize(16).fillColor(blue);
            doc.text('ANANDAM', 40, y + 4);
          }
        } else {
          doc.font('Helvetica-Bold').fontSize(16).fillColor(blue);
          doc.text('ANANDAM', 40, y + 4);
        }

        // E-INVOICE title on the right
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#1e293b');
        doc.text('E-INVOICE', 40, y + 4, { align: 'right', width: W });

        doc.font('Helvetica').fontSize(9).fillColor(midGray);
        doc.text(invoice.invoice_number, 40, y + 16, { align: 'right', width: W });

        const typeLabel = invoice.invoice_type === 'TAX'
          ? 'Dengan Faktur Pajak'
          : 'Proforma Invoice';
        doc.font('Helvetica-Bold').fontSize(8).fillColor(blue);
        doc.text(typeLabel, 40, y + 24, { align: 'right', width: W });

        y += 34;

        // ── DIVIDER LINE ────────────────────────────────────────────
        doc.strokeColor(lightGray).lineWidth(0.5).moveTo(40, y).lineTo(40 + W, y).stroke();
        y += 8;

        // ── TWO-COLUMN INFO SECTION ─────────────────────────────────
        const colWidth = W / 2 - 6;
        const leftX = 40;
        const rightX = 40 + W / 2 + 6;

        // --- LEFT COLUMN: PEMBELI (Buyer Info) ---
        doc.font('Helvetica-Bold').fontSize(8).fillColor(blue);
        doc.text('INFORMASI PEMBELI', leftX, y);

        let rowY = y + 8;
        const buyerRows = [
          { label: 'Nama', value: invoice.customer_name || '-' },
          { label: 'No. HP', value: invoice.customer_phone || '-' },
          { label: 'Email', value: invoice.customer_email || '-' },
          { label: 'Alamat', value: invoice.customer_address || '-' },
        ];

        buyerRows.forEach((row) => {
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(midGray);
          doc.text(row.label, leftX, rowY);

          doc.font('Helvetica').fontSize(8.5).fillColor(darkGray);
          if (row.label === 'Alamat') {
            const lines = doc.text(row.value, leftX + 35, rowY, {
              width: colWidth - 35,
              lineBreak: true,
            });
            rowY += 14;
          } else {
            doc.text(row.value, leftX + 35, rowY);
            rowY += 8;
          }
        });

        const buyerEndY = rowY;

        // --- RIGHT COLUMN: PENJUAL (Just "Anandam ID") ---
        doc.font('Helvetica-Bold').fontSize(8).fillColor(blue);
        doc.text('INFORMASI PENJUAL', rightX, y);

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(midGray);
        doc.text('Nama', rightX, y + 8);
        doc.font('Helvetica').fontSize(8.5).fillColor(darkGray);
        doc.text('Anandam ID', rightX + 35, y + 8);

        y = Math.max(buyerEndY, y + 20) + 4;

        // ── DIVIDER LINE ────────────────────────────────────────────
        doc.strokeColor(lightGray).lineWidth(0.5).moveTo(40, y).lineTo(40 + W, y).stroke();
        y += 8;

        // ── ORDER INFO ROW ──────────────────────────────────────────
        const infoColW = W / 4 - 2;
        const orderInfo = [
          { label: 'NO. PESANAN', value: invoice.invoice_number },
          {
            label: 'TANGGAL TRANSAKSI',
            value: formatDate(invoice.issued_at || invoice.created_at),
          },
          { label: 'METODE PEMBAYARAN', value: invoice.payment_method || '-' },
          {
            label: 'JASA KIRIM',
            value: invoice.courier_name
              ? `${invoice.courier_name}${invoice.courier_service ? ' - ' + invoice.courier_service : ''}`
              : '-',
          },
        ];

        orderInfo.forEach((info, i) => {
          const x = 40 + i * (infoColW + 8);
          doc.font('Helvetica-Bold').fontSize(7).fillColor(midGray);
          doc.text(info.label, x, y);
          doc.font('Helvetica').fontSize(8).fillColor(darkGray);
          doc.text(info.value, x, y + 6);
        });

        y += 16;

        // ── TABLE HEADER ─────────────────────────────────────────────
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

          // White background with subtle border
          doc.rect(40, y, W, 48).fill('#ffffff').stroke('#cbd5e1');
          doc.font('Helvetica-Bold').fontSize(8).fillColor(darkGray);
          doc.text('DATA FAKTUR PAJAK', 52, y + 8);
          doc.font('Helvetica').fontSize(7.5).fillColor(midGray);
          doc.text(`Perusahaan  : ${invoice.company_name}`, 52, y + 18);
          doc.text(
            `Alamat        : ${invoice.company_address || '-'}`,
            52,
            y + 26,
          );
          if (invoice.customer_npwp) {
            doc.text(
              `NPWP          : ${invoice.customer_npwp}`,
              40 + W / 2,
              y + 18,
            );
          }
          if (invoice.company_email) {
            doc.text(
              `Email            : ${invoice.company_email}`,
              40 + W / 2,
              y + 26,
            );
          }

          // Note about email delivery
          doc.font('Helvetica-Oblique').fontSize(7).fillColor(midGray);
          doc.text(
            '* Faktur Pajak akan dikirim melalui email dalam 1-2 hari kerja setelah pesanan selesai.',
            52,
            y + 38,
            { width: W - 24 },
          );

          y += 58;
        }

        // ── FOOTER ───────────────────────────────────────────────────
        const pageH = doc.page.height;
        doc
          .font('Helvetica-Oblique')
          .fontSize(7)
          .fillColor('#94a3b8')
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

  async getPdfPath(invoice: Invoice): Promise<string> {
    const filename = `${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
    const relativePath = `/uploads/invoices/${filename}`;
    const filePath = path.join(process.cwd(), 'uploads', 'invoices', filename);

    if (!fs.existsSync(filePath)) {
      try {
        await this.generatePdf(invoice, null as any);
        invoice.pdf_url = relativePath;
        await this.invoiceRepo.save(invoice);
      } catch (err: any) {
        throw new NotFoundException(
          `Gagal membuat file PDF invoice: ${err.message}`,
        );
      }
    }

    return filePath;
  }
}
