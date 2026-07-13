const PDFDocument = require('pdfkit');
const fs = require('fs');

const STORE_NAME = 'ANANDAM COMPUTER';
const LABEL_VERSION = 'v2';

const snap = {
  "awb": "WYB-1783916688909",
  "isCod": false,
  "items": [
    {
      "qty": 1,
      "name": "TP-Link Archer T2UB Nano | 600Mbps Wi-Fi Adapter | Bluetooth 4.2 Wireless Adapter | Dual Band Laptop Pc",
      "weight": 1000
    }
  ],
  "sender": {
    "name": "Anandam Computer",
    "phone": "6281228134747",
    "address": "Jl. Affandi No.17, Soropadan, Condongcatur, Kec. Depok, Kabupaten Sleman, Yogyakarta 55283"
  },
  "courier": {
    "name": "JNE",
    "service": "Reguler"
  },
  "invoice": "INV-20260713-4195",
  "version": "v2",
  "order_id": "76a3231e-d980-44a4-aa6d-4c529c948675",
  "weightKg": "1.0",
  "isFragile": false,
  "recipient": {
    "name": "Aflah Firdaus",
    "phone": "081512295179",
    "address": "WANADADI, WANADADI, KABUPATEN BANJARNEGARA, JAWA TENGAH (Rumah Pak RT) (Rumah Pak RT)"
  },
  "created_at": "2026-07-13T04:24:49.014Z",
  "printCount": 0,
  "shipment_id": "2484a6ec-fe7d-462f-88c2-20c1c99f46f4",
  "trackingUrl": ""
};

const shipment = {
  id: "2484a6ec-fe7d-462f-88c2-20c1c99f46f4",
  awb_number: "WYB-1783916688909",
  courier_name: "JNE",
  courier_service: "Reguler"
};

function encodeCode128(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const bars = (code % 7) + 1;
    result += '\u2588'.repeat(Math.max(1, bars));
    result += ' '.repeat(Math.max(1, 4 - bars));
  }
  return result;
}

try {
  const doc = new PDFDocument({
    size: [100, 150],
    margin: 3,
    info: {
      Title: `Shipping Label - ${snap.invoice || shipment.id}`,
      Author: STORE_NAME,
      Subject: 'Shipping Label',
    },
  });

  const buffers = [];
  doc.on('data', (chunk) => buffers.push(chunk));
  doc.on('end', () => {
    console.log("PDF generation finished successfully. Buffer length:", Buffer.concat(buffers).length);
  });

  const pageWidth = 100;
  let y = 3;
  const mx = 3;
  const maxW = pageWidth - mx * 2;

  const bold = (size) => { doc.font('Helvetica-Bold', size); };
  const normal = (size) => { doc.font('Helvetica', size); };
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
  const barcodeText = encodeCode128(snap.awb || shipment.awb_number);
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

  doc.end();
} catch (e) {
  console.error("PDF generation failed:", e);
}
