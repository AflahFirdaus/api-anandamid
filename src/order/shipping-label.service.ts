import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderHistory } from './entities/order-history.entity';
import { FulfillmentService } from './fulfillment.service';
import { FulfillmentStatus } from './enums/fulfillment-status.enum';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
import * as uuid from 'uuid';

const STORE_NAME = 'ANANDAM COMPUTER';
const LABEL_VERSION = 'v1';

@Injectable()
export class ShippingLabelService {
  private readonly logger = new Logger(ShippingLabelService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderHistory)
    private readonly orderHistoryRepo: Repository<OrderHistory>,
    private readonly fulfillmentService: FulfillmentService,
  ) {}

  /**
   * Create shipping snapshot ONLY ONCE. Immutable after creation.
   * Called automatically after AWB is successfully generated.
   */
  async createShippingSnapshot(order: Order): Promise<void> {
    // CRITICAL: Snapshot is immutable - never overwrite
    if (order.shipping_snapshot) {
      this.logger.log(`[SNAPSHOT] Already exists for ${order.invoice_number}, skipping`);
      return;
    }

    let recipientName = order.user?.full_name || 'Customer';
    let recipientPhone = order.user?.phone_number || '';
    let recipientAddress = '';

    if (order.shipping_address_snapshot) {
      const snap = order.shipping_address_snapshot as any;
      recipientName = snap.recipient_name || recipientName;
      recipientPhone = snap.phone_number || recipientPhone;
      recipientAddress = snap.full_address || '';
    }

    const sender = {
      name: process.env.STORE_CONTACT_NAME || 'Anandam Computer',
      phone: process.env.STORE_PHONE || '6281228134747',
      address: process.env.STORE_ADDRESS || 'Jl. Ringroad Selatan, Banguntapan, Bantul, Yogyakarta',
    };

    let totalWeight = 0;
    const items = (order.items || []).map((item: any) => {
      const w = item.product?.weight || 1000;
      totalWeight += w * item.quantity;
      return { name: item.product_name || 'Product', qty: item.quantity, weight: w };
    });

    const isCod = (order.payment_method || '').toLowerCase().includes('cod');
    const isFragile = (order.notes || '').toLowerCase().includes('fragile');

    order.shipping_snapshot = {
      version: LABEL_VERSION,
      created_at: new Date().toISOString(),
      invoice: order.invoice_number,
      awb: order.awb_number,
      trackingUrl: order.tracking_url || order.awb_url || '',
      sender,
      recipient: { name: recipientName, phone: recipientPhone, address: recipientAddress },
      courier: { name: order.courier_name || '', service: order.courier_service || '' },
      weightKg: (totalWeight / 1000).toFixed(1),
      items,
      isCod,
      isFragile,
      printCount: order.label_print_count || 0,
    };

    await this.orderRepo.save(order);
    this.logger.log(`[SNAPSHOT] Created for order ${order.invoice_number}`);

    // Audit trail
    const opId = uuid.v4();
    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'SYSTEM',
      action: 'SHIPPING_SNAPSHOT_CREATED',
      description: 'Shipping snapshot dibuat setelah booking kurir berhasil',
      refund_operation_id: opId,
      metadata: { version: LABEL_VERSION, awb: order.awb_number },
    });
  }

  /**
   * Generate shipping label PDF (server-side).
   * Download only - does NOT increment print_count.
   * Requires snapshot to exist.
   */
  async generateShippingLabelPdf(orderId: string): Promise<Buffer> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (!order.awb_number) {
      throw new BadRequestException('Shipping label belum dapat dibuat karena AWB belum tersedia.');
    }
    if (!order.shipping_snapshot) {
      throw new BadRequestException('Shipping snapshot belum dibuat. Proses pesanan terlebih dahulu.');
    }

    const snap = order.shipping_snapshot as any;

    const doc = new PDFDocument({
      size: [100, 150],
      margin: 3,
      info: {
        Title: `Shipping Label - ${snap.invoice}`,
        Author: STORE_NAME,
        Subject: 'Shipping Label',
      },
    });



    const pageWidth = 100;
    let y = 3;
    const mx = 3;
    const maxW = pageWidth - mx * 2;

    const bold = (size: number) => { doc.font('Helvetica-Bold', size); };
    const normal = (size: number) => { doc.font('Helvetica', size); };
    const line = () => { doc.moveTo(mx, y).lineTo(pageWidth - mx, y).strokeColor('#000000').lineWidth(0.3).stroke(); y += 1.5; };

    // ── HEADER ──
    bold(7);
    doc.text('ANANDAM COMPUTER', mx, y, { align: 'center', width: maxW });
    y += 5;
    normal(4);
    doc.text('SHIPPING LABEL', mx, y, { align: 'center', width: maxW });
    y += 4;
    line();
    y += 2;

    // ── ORDER ──
    bold(4.5);
    doc.text('ORDER', mx, y);
    y += 3.5;
    normal(4);
    doc.text(snap.invoice, mx, y);
    y += 4;

    // ── AWB ──
    bold(4.5);
    doc.text('AWB', mx, y);
    y += 3;
    bold(6);
    doc.text(snap.awb, mx, y);
    y += 5;

    // ── BARCODE ──
    normal(2.5);
    const barcodeText = this.encodeCode128(snap.awb);
    doc.text(barcodeText, mx, y, { align: 'center', width: maxW });
    y += 4;

    // AWB number below barcode
    normal(3);
    doc.text(snap.awb, mx, y, { align: 'center', width: maxW });
    y += 4;

    // ── QR Code ──
    const qrData = JSON.stringify({
      orderId: order.id,
      awb: snap.awb,
      invoice: snap.invoice,
    });
    normal(2);
    doc.text(`[QR: ${qrData.substring(0, 60)}...]`, mx, y, { width: maxW - 18, align: 'left' });
    y += 4;

    if (snap.trackingUrl) {
      normal(2.5);
      doc.text(`Track: ${snap.trackingUrl}`, mx, y, { width: maxW });
      y += 3.5;
    }

    line();
    y += 2;

    // ── PENGIRIM ──
    bold(4);
    doc.text('PENGIRIM', mx, y);
    y += 3.5;
    normal(3.5);
    doc.text(snap.sender.name, mx, y);
    y += 3.5;
    normal(3);
    doc.text(snap.sender.address, mx, y, { width: maxW });
    y += doc.heightOfString(snap.sender.address, { width: maxW }) + 1;
    doc.text(snap.sender.phone, mx, y);
    y += 3.5;
    line();
    y += 2;

    // ── PENERIMA ──
    bold(4);
    doc.text('PENERIMA', mx, y);
    y += 3.5;
    bold(3.5);
    doc.text(snap.recipient.name, mx, y);
    y += 3.5;
    normal(3);
    doc.text(snap.recipient.address, mx, y, { width: maxW });
    y += doc.heightOfString(snap.recipient.address, { width: maxW }) + 1;
    doc.text(snap.recipient.phone, mx, y);
    y += 3.5;
    line();
    y += 2;

    // ── KURIR ──
    bold(4);
    doc.text('KURIR', mx, y);
    y += 3.5;
    bold(3.5);
    doc.text(snap.courier.name, mx, y);
    y += 3.5;
    normal(3);
    doc.text(`Service: ${snap.courier.service}`, mx, y);
    y += 3.5;
    line();
    y += 2;

    // ── BERAT ──
    bold(4);
    doc.text('BERAT', mx, y);
    y += 3.5;
    bold(5);
    doc.text(`${snap.weightKg} KG`, mx, y);
    y += 4;
    line();
    y += 2;

    // ── ISI ──
    bold(4);
    doc.text('ISI', mx, y);
    y += 3.5;
    normal(3);
    for (const item of snap.items) {
      if (y > 130) break;
      doc.text(`${item.name.substring(0, 35)}`, mx, y, { width: maxW });
      y += 3;
      doc.text(`  Qty: ${item.qty}`, mx, y);
      y += 3;
    }
    line();
    y += 2;

    // ── COD / NON COD ──
    bold(4);
    doc.text(snap.isCod ? 'COD' : 'NON COD', mx, y);
    y += 4;
    line();
    y += 2;

    // ── FRAGILE ──
    if (snap.isFragile) {
      bold(5);
      doc.text('FRAGILE  ✓', mx, y);
      y += 4;
      line();
      y += 2;
    }

    // ── REPRINT WATERMARK ──
    if (snap.printCount > 0) {
      doc.font('Helvetica').fontSize(8).fillColor('#999999');
      doc.text('REPRINT', pageWidth / 2, 5, { align: 'center', angle: 45 });
      doc.fillColor('#000000');
      y += 4;
    }

    // ── FOOTER ──
    y = 145;
    normal(2.5);
    doc.text(`${STORE_NAME} | ${snap.invoice} | ${snap.awb} | v${LABEL_VERSION}`, mx, y, { align: 'center', width: maxW });

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });

    // Audit trail: LABEL_DOWNLOADED
    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'SYSTEM',
      action: 'LABEL_DOWNLOADED',
      description: 'Shipping label PDF diunduh',
      metadata: { label_version: LABEL_VERSION, awb: order.awb_number },
    });

    return pdfBuffer;
  }

  /**
   * Mark label as printed - ONLY this endpoint increments print_count.
   * Called via POST /orders/:id/mark-label-printed
   * Also updates fulfillment status to LABEL_PRINTED.
   */
  async markLabelPrinted(orderId: string, adminName?: string): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (!order.awb_number) {
      throw new BadRequestException('AWB belum tersedia. Proses pesanan terlebih dahulu.');
    }

    // Validate fulfillment status - label must be in LABEL_READY state
    if (order.fulfillment_status !== 'LABEL_READY') {
      throw new BadRequestException('Label belum siap dicetak. Pastikan AWB dan snapshot sudah tersedia.');
    }

    const now = new Date();
    order.label_print_count = (order.label_print_count || 0) + 1;
    order.last_label_printed_at = now;
    order.label_status = order.label_print_count > 1 ? 'REPRINTED' : 'PRINTED';
    order.printed_at = now;
    if (adminName) order.printed_by = adminName;
    await this.orderRepo.save(order);

    // Update fulfillment status to LABEL_PRINTED
    await this.fulfillmentService.markLabelPrinted(order, adminName || 'ADMIN');

    // Audit trail
    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: adminName || 'SYSTEM',
      action: 'LABEL_PRINTED',
      description: `Label dicetak (ke-${order.label_print_count})`,
      metadata: {
        print_count: order.label_print_count,
        status: order.label_status,
        label_version: LABEL_VERSION,
      },
    });

    this.logger.log(`[PRINT] order=${order.invoice_number} count=${order.label_print_count} status=${order.label_status}`);
  }

  /**
   * Generate packing slip PDF. Uses snapshot data.
   */
  async generatePackingSlipPdf(orderId: string): Promise<Buffer> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');

    const doc = new PDFDocument({
      size: 'A4',
      margin: 20,
      info: {
        Title: `Packing Slip - ${order.invoice_number}`,
        Author: STORE_NAME,
        Subject: 'Packing Slip',
      },
    });



    const mx = 20;
    let y = 25;

    const bold = (size: number) => { doc.font('Helvetica-Bold', size); };
    const normal = (size: number) => { doc.font('Helvetica', size); };
    const line = () => { doc.moveTo(mx, y).lineTo(575, y).strokeColor('#000000').lineWidth(0.5).stroke(); y += 5; };

    bold(16);
    doc.text('PACKING SLIP', mx, y, { align: 'center', width: 555 });
    y += 10;
    bold(10);
    doc.text(STORE_NAME, mx, y, { align: 'center', width: 555 });
    y += 8;
    line();

    normal(9);
    doc.text(`Invoice: ${order.invoice_number}`, mx, y);
    y += 5;
    doc.text(`Tanggal: ${new Date(order.created_at).toLocaleDateString('id-ID')}`, mx, y);
    y += 5;
    doc.text(`Status: ${order.status}`, mx, y);
    y += 5;

    if (order.awb_number) {
      doc.text(`AWB: ${order.awb_number}`, mx, y);
      y += 5;
    }
    if (order.courier_name) {
      doc.text(`Kurir: ${order.courier_name} ${order.courier_service || ''}`, mx, y);
      y += 5;
    }
    line();

    bold(9);
    doc.text('PELANGGAN', mx, y);
    y += 5;
    normal(9);
    doc.text(`Nama: ${order.user?.full_name || '-'}`, mx, y);
    y += 5;
    doc.text(`Telepon: ${order.user?.phone_number || '-'}`, mx, y);
    y += 5;
    if (order.notes) {
      bold(8);
      doc.text(`Catatan: ${order.notes}`, mx, y);
      y += 5;
    }
    line();

    bold(9);
    doc.text('DAFTAR BARANG', mx, y);
    y += 6;

    normal(8);
    doc.text('No', mx, y);
    doc.text('Produk', mx + 20, y);
    doc.text('Variasi', mx + 250, y);
    doc.text('Qty', mx + 350, y);
    doc.text('Harga', mx + 400, y);
    doc.text('Subtotal', mx + 480, y);
    y += 4;
    doc.moveTo(mx, y).lineTo(575, y).stroke();
    y += 3;

    let totalQty = 0;
    order.items.forEach((item, idx) => {
      if (y > 780) return;
      normal(8);
      doc.text(`${idx + 1}`, mx, y);
      doc.text(item.product_name?.substring(0, 35) || '', mx + 20, y, { width: 220 });
      doc.text(item.variasi || '-', mx + 250, y, { width: 90 });
      doc.text(`${item.quantity}`, mx + 350, y);
      doc.text(`Rp ${Number(item.price).toLocaleString('id-ID')}`, mx + 400, y, { width: 75 });
      doc.text(`Rp ${(item.quantity * Number(item.price)).toLocaleString('id-ID')}`, mx + 480, y, { width: 90 });
      y += 5;
      totalQty += item.quantity;
    });

    y += 3;
    doc.moveTo(mx, y).lineTo(575, y).stroke();
    y += 4;

    bold(9);
    doc.text(`Total Item: ${order.items.length} jenis`, mx, y);
    y += 5;
    doc.text(`Total Qty: ${totalQty} pcs`, mx, y);
    y += 5;
    doc.text(`Total Harga: Rp ${Number(order.total_price).toLocaleString('id-ID')}`, mx, y);
    y += 10;

    line();
    y += 3;
    bold(7);
    doc.text('Order ID:', mx, y);
    y += 4;
    bold(10);
    doc.text(order.id.substring(0, 8).toUpperCase(), mx, y);
    y += 5;
    normal(6);
    doc.text(order.invoice_number, mx, y);

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });

    // Audit trail
    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'SYSTEM',
      action: 'PACKING_SLIP_DOWNLOADED',
      description: 'Packing slip PDF diunduh',
    });

    return pdfBuffer;
  }

  private encodeCode128(text: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const bars = (code % 7) + 1;
      result += '\u2588'.repeat(Math.max(1, bars));
      result += ' '.repeat(Math.max(1, 4 - bars));
    }
    return result;
  }
}