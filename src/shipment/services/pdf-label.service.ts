import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from '../entities/shipment.entity';
import { Order } from '../../order/entities/order.entity';
import { ShipmentItem } from '../entities/shipment-item.entity';
import { ShipmentTracking } from '../entities/shipment-tracking.entity';
import { BookingLog } from '../entities/booking-log.entity';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
import * as uuid from 'uuid';

const STORE_NAME = 'ANANDAM COMPUTER';
const LABEL_VERSION = 'v2';

@Injectable()
export class PdfLabelService {
  private readonly logger = new Logger(PdfLabelService.name);

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ShipmentItem)
    private readonly shipmentItemRepo: Repository<ShipmentItem>,
    @InjectRepository(ShipmentTracking)
    private readonly trackingRepo: Repository<ShipmentTracking>,
    @InjectRepository(BookingLog)
    private readonly bookingLogRepo: Repository<BookingLog>,
  ) {}

  /**
   * Create shipping snapshot on a Shipment — ONLY ONCE, immutable.
   * Called after AWB is generated and shipment is BOOKED.
   * Reads data from Order (ShippingAddressSnapshot, items) and Shipment (AWB, courier).
   */
  async createShippingSnapshot(shipment: Shipment, order: Order): Promise<void> {
    // CRITICAL: Snapshot is immutable - never overwrite
    if (shipment.shipping_snapshot) {
      this.logger.log(`[SNAPSHOT] Already exists for shipment=${shipment.id}, order=${order.invoice_number}, skipping`);
      return;
    }

    // Get recipient from order address snapshot
    let recipientName = order.user?.full_name || 'Customer';
    let recipientPhone = order.user?.phone_number || '';
    let recipientAddress = '';

    if (order.shipping_address_snapshot) {
      const snap = order.shipping_address_snapshot as Record<string, any>;
      recipientName = snap.recipient_name || recipientName;
      recipientPhone = snap.phone_number || recipientPhone;
      recipientAddress = snap.full_address || '';
    }

    const sender = {
      name: process.env.STORE_CONTACT_NAME || 'Anandam Computer',
      phone: process.env.STORE_PHONE || '6281228134747',
      address: process.env.STORE_ADDRESS || 'Jl. Ringroad Selatan, Banguntapan, Bantul, Yogyakarta',
    };

    // Calculate total weight from order items
    let totalWeight = 0;
    const items = (order.items || []).map((item: any) => {
      const w = item.product?.weight || 1000;
      totalWeight += w * item.quantity;
      return {
        name: item.product_name || 'Product',
        qty: item.quantity,
        weight: w,
      };
    });

    const isCod = (order.payment_method || '').toLowerCase().includes('cod');
    const isFragile = (order.notes || '').toLowerCase().includes('fragile');

    shipment.shipping_snapshot = {
      version: LABEL_VERSION,
      created_at: new Date().toISOString(),
      invoice: order.invoice_number,
      order_id: order.id,
      shipment_id: shipment.id,
      awb: shipment.awb_number,
      trackingUrl: shipment.tracking_url || shipment.awb_url || '',
      sender,
      recipient: {
        name: recipientName,
        phone: recipientPhone,
        address: recipientAddress,
      },
      courier: {
        name: shipment.courier_name || '',
        service: shipment.courier_service || '',
      },
      weightKg: (totalWeight / 1000).toFixed(1),
      items,
      isCod,
      isFragile,
      printCount: 0,
    };

    await this.shipmentRepo.save(shipment);
    this.logger.log(`[SNAPSHOT] Created for shipment=${shipment.id}, order=${order.invoice_number} (immutable)`);
  }

  /**
   * Generate shipping label PDF from shipment snapshot.
   */
  async generateShippingLabelPdf(shipmentId: string): Promise<Buffer> {
    const shipment = await this.shipmentRepo.findOne({
      where: { id: shipmentId },
      relations: ['items'],
    });
    if (!shipment) throw new NotFoundException('Shipment tidak ditemukan');
    if (!shipment.awb_number) {
      throw new BadRequestException('AWB belum tersedia.');
    }
    if (!shipment.shipping_snapshot) {
      throw new BadRequestException('Shipping snapshot belum dibuat.');
    }

    const snap = shipment.shipping_snapshot as Record<string, any>;

    const doc = new PDFDocument({
      size: [100, 150],
      margin: 3,
      info: {
        Title: `Shipping Label - ${snap.invoice || shipment.id}`,
        Author: STORE_NAME,
        Subject: 'Shipping Label',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));

    const pageWidth = 100;
    let y = 3;
    const mx = 3;
    const maxW = pageWidth - mx * 2;

    const bold = (size: number) => { doc.font('Helvetica-Bold', size); };
    const normal = (size: number) => { doc.font('Helvetica', size); };
    const line = () => {
      doc.moveTo(mx, y).lineTo(pageWidth - mx, y).strokeColor('#000000').lineWidth(0.3).stroke();
      y += 1.5;
    };

    // HEADER
    bold(7);
    doc.text('ANANDAM COMPUTER', mx, y, { align: 'center', width: maxW });
    y += 5;
    normal(4);
    doc.text('SHIPPING LABEL', mx, y, { align: 'center', width: maxW });
    y += 4;
    line();
    y += 2;

    // ORDER
    bold(4.5);
    doc.text('ORDER', mx, y);
    y += 3.5;
    normal(4);
    doc.text(snap.invoice || shipment.id.substring(0, 8).toUpperCase(), mx, y);
    y += 4;

    // AWB
    bold(4.5);
    doc.text('AWB', mx, y);
    y += 3;
    bold(6);
    doc.text(snap.awb || shipment.awb_number, mx, y);
    y += 5;

    // BARCODE
    normal(2.5);
    const barcodeText = this.encodeCode128(snap.awb || shipment.awb_number);
    doc.text(barcodeText, mx, y, { align: 'center', width: maxW });
    y += 4;
    normal(3);
    doc.text(snap.awb || shipment.awb_number, mx, y, { align: 'center', width: maxW });
    y += 4;

    // QR
    if (snap.trackingUrl) {
      normal(2.5);
      doc.text(`Track: ${snap.trackingUrl}`, mx, y, { width: maxW });
      y += 3.5;
    }

    line();
    y += 2;

    // PENGIRIM
    bold(4);
    doc.text('PENGIRIM', mx, y);
    y += 3.5;
    normal(3.5);
    doc.text(snap.sender?.name || STORE_NAME, mx, y);
    y += 3.5;
    normal(3);
    doc.text(snap.sender?.address || '', mx, y, { width: maxW });
    y += doc.heightOfString(snap.sender?.address || '', { width: maxW }) + 1;
    y += 3.5;
    line();
    y += 2;

    // PENERIMA
    bold(4);
    doc.text('PENERIMA', mx, y);
    y += 3.5;
    bold(3.5);
    doc.text(snap.recipient?.name || '', mx, y);
    y += 3.5;
    normal(3);
    doc.text(snap.recipient?.address || '', mx, y, { width: maxW });
    y += doc.heightOfString(snap.recipient?.address || '', { width: maxW }) + 1;
    y += 3.5;
    line();
    y += 2;

    // KURIR
    bold(4);
    doc.text('KURIR', mx, y);
    y += 3.5;
    bold(3.5);
    doc.text(snap.courier?.name || shipment.courier_name || '', mx, y);
    y += 3.5;
    normal(3);
    doc.text(`Service: ${snap.courier?.service || shipment.courier_service || ''}`, mx, y);
    y += 3.5;
    line();
    y += 2;

    // BERAT
    bold(4);
    doc.text('BERAT', mx, y);
    y += 3.5;
    bold(5);
    doc.text(`${snap.weightKg || '0.0'} KG`, mx, y);
    y += 4;
    line();
    y += 2;

    // ISI
    bold(4);
    doc.text('ISI', mx, y);
    y += 3.5;
    normal(3);
    const snapItems = snap.items || [];
    for (const item of snapItems) {
      if (y > 130) break;
      doc.text(`${(item.name || 'Product').substring(0, 35)}`, mx, y, { width: maxW });
      y += 3;
      doc.text(`  Qty: ${item.qty || 0}`, mx, y);
      y += 3;
    }
    line();
    y += 2;

    // COD / NON COD
    bold(4);
    doc.text(snap.isCod ? 'COD' : 'NON COD', mx, y);
    y += 4;
    line();
    y += 2;

    // FRAGILE
    if (snap.isFragile) {
      bold(5);
      doc.text('FRAGILE  ✓', mx, y);
      y += 4;
      line();
      y += 2;
    }

    // REPRINT WATERMARK
    if (snap.printCount > 0) {
      doc.font('Helvetica').fontSize(8).fillColor('#999999');
      doc.text('REPRINT', pageWidth / 2, 5, { align: 'center', angle: 45 });
      doc.fillColor('#000000');
      y += 4;
    }

    // FOOTER
    y = 145;
    normal(2.5);
    doc.text(
      `${STORE_NAME} | ${snap.invoice || shipment.id.substring(0, 8)} | ${LABEL_VERSION}`,
      mx, y, { align: 'center', width: maxW },
    );


    await new Promise<void>((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
      doc.end();
    });

    return Buffer.concat(buffers);
  }


  /**
   * Generate packing slip PDF - uses shipment snapshot data.
   */
  async generatePackingSlipPdf(order: any): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 20,
      info: {
        Title: `Packing Slip - ${order.invoice_number}`,
        Author: STORE_NAME,
        Subject: 'Packing Slip',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));

    const mx = 20;
    let y = 25;

    const bold = (size: number) => { doc.font('Helvetica-Bold', size); };
    const normal = (size: number) => { doc.font('Helvetica', size); };
    const line = () => {
      doc.moveTo(mx, y).lineTo(575, y).strokeColor('#000000').lineWidth(0.5).stroke();
      y += 5;
    };

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
    (order.items || []).forEach((item: any, idx: number) => {
      if (y > 780) return;
      normal(8);
      doc.text(`${idx + 1}`, mx, y);
      doc.text((item.product_name || '').substring(0, 35), mx + 20, y, { width: 220 });
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
    doc.text(`Total Item: ${order.items?.length || 0} jenis`, mx, y);
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
    doc.text((order.id || '').substring(0, 8).toUpperCase(), mx, y);
    y += 5;
    normal(6);
    doc.text(order.invoice_number, mx, y);

    await new Promise<void>((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
      doc.end();
    });

    return Buffer.concat(buffers);
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