import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_LOGO_PATH = path.resolve(__dirname, '../assets/seekon_bg-removebg-preview.png');

/**
 * Generates an in-memory branded PDF e-receipt for walk-in / POS orders.
 * Tailored for WhatsApp mobile document view (compact, razor-sharp typography, Seekon brand colors).
 * 
 * @param {object} order - The populated Order document.
 * @param {object} options - Optional metadata (cashier name, custom notes).
 * @returns {Promise<Buffer>}
 */
export const generateReceiptPDF = async (order, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [300, 700], // Compact mobile-optimized receipt format
        margins: { top: 16, bottom: 20, left: 18, right: 18 }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const PAGE_WIDTH = 300;
      const LEFT_X = 18;
      const RIGHT_X = PAGE_WIDTH - 18;
      const CONTENT_WIDTH = RIGHT_X - LEFT_X;

      // 1. BRAND HEADER WITH LOGO INTEGRATION
      const hasLogo = fs.existsSync(LOCAL_LOGO_PATH);
      const HEADER_HEIGHT = hasLogo ? 62 : 48;

      doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT).fill('#09090b'); // Obsidian glass / zinc-950

      if (hasLogo) {
        // Centered official Seekon brand logo
        try {
          doc.image(LOCAL_LOGO_PATH, (PAGE_WIDTH - 90) / 2, 8, { width: 90 });
        } catch (imgErr) {
          console.warn('Receipt logo draw fallback:', imgErr.message);
          doc.fillColor('#FFFFFF')
             .fontSize(16)
             .font('Helvetica-Bold')
             .text('SEEKON', LEFT_X, 14, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 2 });
        }
        doc.fontSize(6.5)
           .font('Helvetica-Bold')
           .fillColor('#10B981')
           .text('OFFICIAL E-RECEIPT  •  WALK-IN SALE', LEFT_X, 48, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 1.2 });
      } else {
        doc.fillColor('#FFFFFF')
           .fontSize(16)
           .font('Helvetica-Bold')
           .text('SEEKON', LEFT_X, 12, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 2 });

        doc.fontSize(7)
           .font('Helvetica')
           .fillColor('#D1D5DB')
           .text('PREMIUM STREETWEAR & APPAREL', LEFT_X, 32, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 1 });
      }

      let currentY = HEADER_HEIGHT + 8;

      // 2. STORE CONTACT & LOCATIONS
      doc.fontSize(6.5)
         .font('Helvetica')
         .fillColor('#4B5563')
         .text('Thika Rd Kahawa Sukari • Kilimani • Runda Mall • Ngong Rd', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

      currentY += 10;
      doc.text('Tel: +254 727 672 772  •  seekonapparel77@gmail.com', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

      currentY += 14;
      // Dotted Divider
      doc.strokeColor('#D1D5DB')
         .lineWidth(0.5)
         .dash(3, { space: 2 })
         .moveTo(LEFT_X, currentY)
         .lineTo(RIGHT_X, currentY)
         .stroke()
         .undash();

      currentY += 8;

      // 3. RECEIPT & TRANSACTION META
      const orderDate = new Date(order.createdAt || Date.now()).toLocaleString('en-KE', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      const orderRef = (order._id ? String(order._id).slice(-8) : 'POS-WALKIN').toUpperCase();
      const cashierName = options.cashierName || order.cashier?.name || 'Store Cashier';
      const customerPhone = order.guestPhone || order.shippingAddress?.phone || order.phoneNumber || 'Walk-in Customer';

      doc.fontSize(7.5)
         .font('Helvetica-Bold')
         .fillColor('#111827')
         .text(`RECEIPT #: SKN-${orderRef}`, LEFT_X, currentY);

      doc.fontSize(7)
         .font('Helvetica')
         .fillColor('#6B7280')
         .text(orderDate, LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'right' });

      currentY += 11;
      doc.text(`Cashier: ${cashierName}`, LEFT_X, currentY);
      doc.text(`Customer: ${customerPhone}`, LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'right' });

      currentY += 14;
      doc.strokeColor('#E5E7EB')
         .lineWidth(0.5)
         .moveTo(LEFT_X, currentY)
         .lineTo(RIGHT_X, currentY)
         .stroke();

      currentY += 6;

      // 4. ITEMS TABLE HEADER
      doc.fontSize(7)
         .font('Helvetica-Bold')
         .fillColor('#111827')
         .text('ITEM / DESCRIPTION', LEFT_X, currentY);

      doc.text('QTY', 170, currentY, { width: 30, align: 'center' });
      doc.text('TOTAL', RIGHT_X - 55, currentY, { width: 55, align: 'right' });

      currentY += 10;
      doc.strokeColor('#111827')
         .lineWidth(0.75)
         .moveTo(LEFT_X, currentY)
         .lineTo(RIGHT_X, currentY)
         .stroke();

      currentY += 6;

      // 5. ITEM ROWS
      const items = order.items || [];
      doc.font('Helvetica').fontSize(7.5);

      items.forEach(item => {
        const itemTotal = Number(item.price) * Number(item.quantity);
        const itemName = (item.name || 'Seekon Item').slice(0, 24);
        const variantText = [item.size, item.color].filter(Boolean).join(' / ');

        doc.font('Helvetica-Bold')
           .fillColor('#111827')
           .text(itemName, LEFT_X, currentY, { width: 150 });

        doc.font('Helvetica')
           .fillColor('#374151')
           .text(`${item.quantity}`, 170, currentY, { width: 30, align: 'center' });

        doc.font('Helvetica-Bold')
           .fillColor('#111827')
           .text(`KES ${itemTotal.toLocaleString()}`, RIGHT_X - 55, currentY, { width: 55, align: 'right' });

        currentY += 10;

        if (variantText) {
          doc.font('Helvetica')
             .fontSize(6.5)
             .fillColor('#6B7280')
             .text(`Variant: ${variantText}`, LEFT_X, currentY);
          currentY += 8;
        }

        currentY += 3;
      });

      // 6. TOTALS & SPLIT PAYMENTS BREAKDOWN
      currentY += 4;
      doc.strokeColor('#E5E7EB')
         .lineWidth(0.5)
         .moveTo(LEFT_X, currentY)
         .lineTo(RIGHT_X, currentY)
         .stroke();

      currentY += 8;

      const totalAmount = Number(order.totalAmount || 0);
      const cashPaid = Number(order.payments?.cash || 0);
      const mpesaPaid = Number(order.payments?.mpesa || 0);

      // Total Line
      doc.fontSize(9)
         .font('Helvetica-Bold')
         .fillColor('#000000')
         .text('TOTAL AMOUNT:', LEFT_X, currentY);

      doc.text(`KES ${totalAmount.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });

      currentY += 16;
      doc.fontSize(7.5).font('Helvetica');

      // Payment Details
      doc.fillColor('#4B5563').text('Payment Method:', LEFT_X, currentY);
      doc.font('Helvetica-Bold').fillColor('#111827').text(order.paymentMethod || 'Split', RIGHT_X - 70, currentY, { width: 70, align: 'right' });

      if (cashPaid > 0) {
        currentY += 11;
        doc.font('Helvetica').fillColor('#6B7280').text('  • Cash Tendered:', LEFT_X, currentY);
        doc.font('Helvetica-Bold').fillColor('#111827').text(`KES ${cashPaid.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });
      }

      if (mpesaPaid > 0) {
        currentY += 11;
        doc.font('Helvetica').fillColor('#6B7280').text('  • M-Pesa:', LEFT_X, currentY);
        doc.font('Helvetica-Bold').fillColor('#111827').text(`KES ${mpesaPaid.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });
      }

      currentY += 18;
      // 7. FOOTER & POLICIES
      doc.strokeColor('#D1D5DB')
         .lineWidth(0.5)
         .dash(3, { space: 2 })
         .moveTo(LEFT_X, currentY)
         .lineTo(RIGHT_X, currentY)
         .stroke()
         .undash();

      currentY += 10;

      doc.fontSize(7.5)
         .font('Helvetica-Bold')
         .fillColor('#111827')
         .text('THANK YOU FOR SHOPPING AT SEEKON!', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

      currentY += 11;
      doc.fontSize(6)
         .font('Helvetica')
         .fillColor('#6B7280')
         .text('Exchanges or returns accepted within 7 days of purchase.', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

      currentY += 8;
      doc.text('Items must be unworn with original tags attached.', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

      currentY += 10;
      doc.fontSize(6)
         .fillColor('#9CA3AF')
         .text('E-Receipt delivered directly to your WhatsApp • seekonapparel.com', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
