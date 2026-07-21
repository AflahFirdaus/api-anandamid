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
      relations: ['items', 'items.product', 'user'],
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
      customer_email: addr.email || addr.recipient_email || order.user?.email || null,
      customer_phone: addr.phone_number || addr.recipient_phone || order.user?.phone_number || null,
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
      ppn: 0, // Disesuaikan dengan entitas
      total: total,
      payment_method: order.payment_method || '',
      courier_name: courierName || null,
      courier_service: courierService || null,
      tracking_number: order.awb_number || order.tracking_number || null,
      status: 'ISSUED',
      generated_at: new Date(),
      issued_at: new Date(),
    } as unknown as Invoice);

    const savedInvoice = await this.invoiceRepo.save(invoice as Invoice);

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

        const W = doc.page.width - 80;
        const brandColor = '#0032B2'; // Warna biru anandam.id
        const black = '#000000';
        const darkGray = '#333333';
        const lightGray = '#f5f5f5';
        const borderGray = '#e0e0e0';

        const rupiah = (n: number) =>
          'Rp' + Number(n).toLocaleString('id-ID');

        const formatDate = (d: Date | string) => {
          const date = new Date(d);
          return `${String(date.getDate()).padStart(2, '0')}/${String(
            date.getMonth() + 1,
          ).padStart(2, '0')}/${date.getFullYear()}`;
        };

        // ── ALL WHITE BACKGROUND ────────────────────────────────────
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');

        // ── 1. BRAND HEADER (Center Aligned) ────────────────────────
        let y = 40;
        const logoPath = path.join(process.cwd(), 'public', 'anandam-logo-blue.svg');
        const textCenterW = 200;
        const textStartX = (doc.page.width - textCenterW) / 2;

        if (fs.existsSync(logoPath)) {
          try {
            // Asumsi logo proporsional, posisikan sejajar dengan teks
            doc.image(logoPath, textStartX - 20, y - 5, { width: 35 });
            doc.font('Helvetica-Bold').fontSize(26).fillColor(brandColor);
            doc.text('anandam.id', textStartX + 20, y, { width: textCenterW, align: 'left' });
          } catch {
            doc.font('Helvetica-Bold').fontSize(26).fillColor(brandColor);
            doc.text('anandam.id', 40, y, { align: 'center', width: W });
          }
        } else {
          doc.font('Helvetica-Bold').fontSize(26).fillColor(brandColor);
          doc.text('anandam.id', 40, y, { align: 'center', width: W });
        }

        y += 50;

        // ── 2. NOTA PESANAN TITLE ───────────────────────────────────
        doc.font('Helvetica').fontSize(11).fillColor(black);
        doc.text('Nota Pesanan', 40, y);
        y += 20;

        // ── 3. BUYER & SELLER INFO (Gray Box) ───────────────────────
        const infoBoxY = y;
        doc.rect(40, infoBoxY, W, 85).fill(lightGray);

        const leftPad = 50;
        const rightPad = 40 + W / 2 + 20;

        // Kolom Kiri: Pembeli
        doc.fillColor(black).font('Helvetica-Bold').fontSize(9);
        doc.text('Nama Pembeli: ', leftPad, infoBoxY + 15, { continued: true })
           .font('Helvetica').text(invoice.customer_name || '-');

        doc.font('Helvetica-Bold').text('Alamat Pembeli:', leftPad, infoBoxY + 30);
        const addressH = doc.heightOfString(invoice.customer_address || '-', { width: W / 2 - 30 });
        doc.font('Helvetica').text(invoice.customer_address || '-', leftPad, infoBoxY + 42, { 
          width: W / 2 - 30, 
          lineBreak: true 
        });

        // Kolom Kanan: Penjual
        doc.font('Helvetica-Bold').text('Nama Penjual: ', rightPad, infoBoxY + 15, { continued: true })
           .font('Helvetica').text('anandam.id Official Store');

        // Nomor Handphone di bawah alamat
        doc.font('Helvetica-Bold').text('No. Handphone Pembeli: ', leftPad, infoBoxY + 42 + Math.max(addressH, 15) + 5, { continued: true })
           .font('Helvetica').text(invoice.customer_phone || '-');

        y = infoBoxY + 105;

        // ── 4. ORDER INFO (4 Kolom Horizontal) ───────────────────────
        const colW = W / 4;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(black);
        doc.text('No. Pesanan', 40, y, { width: colW });
        doc.text('Tanggal Transaksi', 40 + colW, y, { width: colW });
        doc.text('Metode Pembayaran', 40 + colW * 2, y, { width: colW });
        doc.text('Jasa Kirim', 40 + colW * 3, y, { width: colW });

        y += 12;
        doc.font('Helvetica').fontSize(9);
        doc.text(invoice.invoice_number, 40, y, { width: colW });
        doc.text(formatDate(invoice.issued_at || invoice.generated_at), 40 + colW, y, { width: colW });
        doc.text(invoice.payment_method || '-', 40 + colW * 2, y, { width: colW });
        
        const courierStr = invoice.courier_name 
          ? `${invoice.courier_name} ${invoice.courier_service || ''}`.trim() 
          : '-';
        doc.text(courierStr, 40 + colW * 3, y, { width: colW });

        y += 30;

        // ── 5. TABEL RINCIAN PESANAN ─────────────────────────────────
        doc.font('Helvetica-Bold').fontSize(10).fillColor(black).text('Rincian Pesanan', 40, y);
        y += 15;

        // Garis Header Tabel
        doc.strokeColor(borderGray).lineWidth(1).moveTo(40, y).lineTo(40 + W, y).stroke();
        y += 8;

        const tCols = {
          no: { x: 40, w: 25 },
          produk: { x: 65, w: 180 },
          variasi: { x: 245, w: 70 },
          harga: { x: 315, w: 70 },
          qty: { x: 385, w: 60 },
          subtotal: { x: 445, w: 70 }
        };

        doc.font('Helvetica-Bold').fontSize(8).fillColor(darkGray);
        doc.text('No.', tCols.no.x, y);
        doc.text('Produk', tCols.produk.x, y);
        doc.text('Variasi', tCols.variasi.x, y);
        doc.text('Harga Produk', tCols.harga.x, y, { align: 'right' });
        doc.text('Kuantitas', tCols.qty.x, y, { align: 'center' });
        doc.text('Subtotal', tCols.subtotal.x, y, { align: 'right' });

        y += 15;
        doc.strokeColor(borderGray).lineWidth(0.5).moveTo(40, y).lineTo(40 + W, y).stroke();
        y += 8;

        // Baris Item Tabel
        doc.font('Helvetica').fontSize(8).fillColor(black);
        let totalQty = 0;

        (invoice.items || []).forEach((item: any, i: number) => {
          doc.text(String(i + 1), tCols.no.x, y);

          const productH = doc.heightOfString(item.product_name || '-', { width: tCols.produk.w });
          doc.text(item.product_name || '-', tCols.produk.x, y, { width: tCols.produk.w });

          doc.text(item.variasi || '-', tCols.variasi.x, y, { width: tCols.variasi.w });
          doc.text(rupiah(item.price), tCols.harga.x, y, { width: tCols.harga.w, align: 'right' });
          doc.text(String(item.quantity), tCols.qty.x, y, { width: tCols.qty.w, align: 'center' });
          doc.text(rupiah(item.subtotal), tCols.subtotal.x, y, { width: tCols.subtotal.w, align: 'right' });

          totalQty += item.quantity;
          y += Math.max(productH, 15) + 5;
        });

        y += 5;
        doc.strokeColor(borderGray).lineWidth(0.5).moveTo(40, y).lineTo(40 + W, y).stroke();
        y += 10;

        // Subtotal Item & Kuantitas
        doc.font('Helvetica-Bold').text('Subtotal', tCols.qty.x - 40, y, { width: 80, align: 'right' });
        doc.text(rupiah(invoice.subtotal), tCols.subtotal.x, y, { width: tCols.subtotal.w, align: 'right' });
        y += 15;
        doc.font('Helvetica-Bold').text(`Total Kuantitas (Aktif) ${totalQty} produk`, tCols.qty.x - 100, y, { width: 140, align: 'right' });

        y += 25;

        // ── 6. SUMMARY BOX (Gray Box Kanan Bawah) ────────────────────
        const sumW = 230;
        const sumX = 40 + W - sumW;
        doc.rect(sumX, y, sumW, 90).fill(lightGray);

        y += 15;
        doc.fillColor(black).font('Helvetica').fontSize(8);

        const drawSumRow = (label: string, value: string, isTotal = false) => {
          if(isTotal) doc.font('Helvetica-Bold').fontSize(10);
          else doc.font('Helvetica').fontSize(8);

          doc.text(label, sumX + 15, y, { width: 110 });
          doc.text(value, sumX + 125, y, { width: 90, align: 'right' });
          y += isTotal ? 20 : 15;
        };

        drawSumRow('Subtotal Pesanan', rupiah(invoice.subtotal));
        drawSumRow('Biaya Layanan/Ongkir', rupiah(invoice.shipping_cost));
        
        if (Number(invoice.discount) > 0) {
          drawSumRow('Diskon Voucher', `-${rupiah(invoice.discount)}`);
        }
        if (Number(invoice.ppn) > 0) {
          drawSumRow('PPN 11%', rupiah(invoice.ppn));
        }

        y += 5;
        drawSumRow('Total Pembayaran', rupiah(invoice.total), true);

        y += 15;
        doc.font('Helvetica').fontSize(8).fillColor(darkGray);
        doc.text('Biaya-biaya yang ditagihkan oleh anandam.id (jika ada) sudah termasuk PPN', sumX, y, { width: sumW });

        // ── 7. FOOTER ────────────────────────────────────────────────
        const pageH = doc.page.height;
        doc.font('Helvetica').fontSize(8).fillColor(black);
        
        // Sesuaikan dengan data perusahaan sebenarnya
        doc.text('PT Anandam Global Integrasi', 40, pageH - 100);
        doc.text('anandam.id | anandamcomputer.com', 40, pageH - 88);
        doc.text('Jalan Teknologi No. 1, DI Yogyakarta', 40, pageH - 76);
        // doc.text('NPWP: 01.234.567.8-901.000', 40, pageH - 64); // Uncomment jika ada NPWP

        doc.fontSize(8).fillColor(darkGray);
        doc.text('1 of 1', 40, pageH - 45, { align: 'center', width: W });
        doc.text('End of receipt', 40, pageH - 35, { align: 'center', width: W });

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
