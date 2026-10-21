import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_DARK_LOGO_PATH = path.resolve(__dirname, '../assets/seekon_bg-removebg-preview.png');
const LOCAL_WHITE_LOGO_PATH = path.resolve(__dirname, '../assets/seekon_logo_white.png');

/**
 * Generates an in-memory branded PDF document for POS / WhatsApp orders.
 * Adapts dynamically based on paymentStatus:
 *  - "pending_pod" / "partial_deposit": Generates "ORDER CONFIRMATION & DISPATCH SLIP"
 *  - "paid": Generates "OFFICIAL E-RECEIPT (PAID)"
 * 
 * Features high-contrast dark-mode safe branding and explicit "Served by" attribution.
 * 
 * @param {object} order - The populated Order document.
 * @param {object} options - Optional metadata (servedBy, cashierName, customNotes).
 * @returns {Promise<Buffer>}
 */
export const generateReceiptPDF = async (order, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const isDispatchSlip = order.paymentStatus === 'pending_pod' || 
                             order.paymentStatus === 'partial_deposit' || 
                             options.isDispatchSlip;

      // Generous single-page height to accommodate delivery info & bold balance box
      const doc = new PDFDocument({
        size: [300, isDispatchSlip ? 820 : 720],
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

      // ─────────────────────────────────────────────────────────────────
      // 1. BRAND HEADER WITH DARK-MODE RESILIENT LOGO
      // ─────────────────────────────────────────────────────────────────
      const hasWhiteLogo = fs.existsSync(LOCAL_WHITE_LOGO_PATH);
      const hasDarkLogo = fs.existsSync(LOCAL_DARK_LOGO_PATH);
      const hasLogo = hasWhiteLogo || hasDarkLogo;
      const HEADER_HEIGHT = hasLogo ? 62 : 48;

      // Deep Obsidian background (#09090b)
      doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT).fill('#09090b');

      if (hasLogo) {
        try {
          if (hasWhiteLogo) {
            // High-contrast pure white logo that shines on dark header
            doc.image(LOCAL_WHITE_LOGO_PATH, (PAGE_WIDTH - 90) / 2, 8, { width: 90 });
          } else {
            // Safe fallback: draw a crisp rounded white pill behind dark logo
            const pillW = 96;
            const pillH = 34;
            const pillX = (PAGE_WIDTH - pillW) / 2;
            doc.roundedRect(pillX, 6, pillW, pillH, 6).fill('#FFFFFF');
            doc.image(LOCAL_DARK_LOGO_PATH, pillX + 3, 8, { width: pillW - 6 });
          }
        } catch (imgErr) {
          console.warn('Receipt logo draw fallback:', imgErr.message);
          doc.fillColor('#FFFFFF')
             .fontSize(16)
             .font('Helvetica-Bold')
             .text('SEEKON', LEFT_X, 14, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 2 });
        }

        if (isDispatchSlip) {
          doc.fontSize(6.5)
             .font('Helvetica-Bold')
             .fillColor('#F59E0B') // Amber/Gold badge for Dispatch Slip
             .text('ORDER CONFIRMATION  •  DISPATCH SLIP', LEFT_X, 48, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 1.2 });
        } else {
          doc.fontSize(6.5)
             .font('Helvetica-Bold')
             .fillColor('#10B981') // Emerald green badge for Paid E-Receipt
             .text('OFFICIAL E-RECEIPT  •  PAID', LEFT_X, 48, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 1.2 });
        }
      } else {
        doc.fillColor('#FFFFFF')
           .fontSize(16)
           .font('Helvetica-Bold')
           .text('SEEKON', LEFT_X, 12, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 2 });

        doc.fontSize(7)
           .font('Helvetica')
           .fillColor(isDispatchSlip ? '#F59E0B' : '#D1D5DB')
           .text(isDispatchSlip ? 'ORDER CONFIRMATION & DISPATCH SLIP' : 'OFFICIAL E-RECEIPT (PAID)', LEFT_X, 32, { width: CONTENT_WIDTH, align: 'center', characterSpacing: 1 });
      }

      let currentY = HEADER_HEIGHT + 8;

      // ─────────────────────────────────────────────────────────────────
      // 2. STORE CONTACT & LOCATIONS
      // ─────────────────────────────────────────────────────────────────
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

      // ─────────────────────────────────────────────────────────────────
      // 3. DOCUMENT META, SERVED BY & CUSTOMER DETAILS
      // ─────────────────────────────────────────────────────────────────
      const orderDate = new Date(order.createdAt || Date.now()).toLocaleString('en-KE', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      const orderRef = (order._id ? String(order._id).slice(-8) : 'ORD-POS').toUpperCase();
      const servedByName = options.servedBy || options.cashierName || order.cashier?.name || order.cashier?.email?.split('@')[0] || 'Store Cashier';
      const customerPhone = order.deliveryDetails?.customerPhone || order.guestPhone || order.shippingAddress?.phone || order.phoneNumber || 'Walk-in Customer';
      const customerName = order.deliveryDetails?.customerName || order.shippingAddress?.name || order.user?.name || 'Customer';

      const docTitle = isDispatchSlip ? `DISPATCH SLIP #: SKN-${orderRef}` : `RECEIPT #: SKN-${orderRef}`;

      doc.fontSize(7.5)
         .font('Helvetica-Bold')
         .fillColor('#111827')
         .text(docTitle, LEFT_X, currentY);

      doc.fontSize(7)
         .font('Helvetica')
         .fillColor('#6B7280')
         .text(orderDate, LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'right' });

      currentY += 11;
      // Explicit "Served by: [Username]" attribution
      doc.font('Helvetica-Bold').fillColor('#111827').text(`Served by: `, LEFT_X, currentY, { continued: true });
      doc.font('Helvetica').fillColor('#374151').text(servedByName);

      doc.font('Helvetica').fillColor('#6B7280').text(`Customer: ${customerPhone}`, LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'right' });

      // Delivery-specific meta rows
      if (isDispatchSlip || order.orderType === 'social-delivery') {
        currentY += 11;
        const platform = (order.socialPlatform && order.socialPlatform !== 'none') 
          ? order.socialPlatform.toUpperCase() 
          : 'SOCIAL';
        doc.font('Helvetica').fillColor('#6B7280').text(`Channel: `, LEFT_X, currentY, { continued: true });
        doc.font('Helvetica-Bold').fillColor('#111827').text(platform);

        doc.font('Helvetica').fillColor('#6B7280').text(`Name: `, LEFT_X + 110, currentY, { continued: true, width: CONTENT_WIDTH - 110, align: 'right' });
        doc.font('Helvetica-Bold').fillColor('#111827').text(customerName, { align: 'right' });

        if (order.deliveryDetails?.location) {
          currentY += 11;
          doc.font('Helvetica').fillColor('#6B7280').text('Deliver To: ', LEFT_X, currentY, { continued: true });
          doc.font('Helvetica-Bold').fillColor('#111827').text(order.deliveryDetails.location);
        }

        const riderNoteText = (order.deliveryDetails?.riderNotes || '').trim();
        if (riderNoteText && !riderNoteText.toLowerCase().includes('interception')) {
          currentY += 11;
          doc.font('Helvetica').fillColor('#6B7280').text('Rider Note: ', LEFT_X, currentY, { continued: true });
          doc.font('Helvetica-Bold').fillColor('#B45309').text(riderNoteText);
        }
      }

      currentY += 14;
      doc.strokeColor('#E5E7EB')
         .lineWidth(0.5)
         .moveTo(LEFT_X, currentY)
         .lineTo(RIGHT_X, currentY)
         .stroke();

      currentY += 6;

      // ─────────────────────────────────────────────────────────────────
      // 4. ITEMS TABLE HEADER
      // ─────────────────────────────────────────────────────────────────
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

      // ─────────────────────────────────────────────────────────────────
      // 5. ITEM ROWS
      // ─────────────────────────────────────────────────────────────────
      const items = order.items || [];
      doc.font('Helvetica').fontSize(7.5);

      let itemsSubtotal = 0;
      items.forEach(item => {
        const itemTotal = Number(item.price) * Number(item.quantity);
        itemsSubtotal += itemTotal;
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

      // ─────────────────────────────────────────────────────────────────
      // 6. TOTALS, DELIVERY FEE & SPLIT PAYMENT BREAKDOWN
      // ─────────────────────────────────────────────────────────────────
      currentY += 4;
      doc.strokeColor('#E5E7EB')
         .lineWidth(0.5)
         .moveTo(LEFT_X, currentY)
         .lineTo(RIGHT_X, currentY)
         .stroke();

      currentY += 8;

      const totalAmount = Number(order.totalAmount || 0);
      const deliveryFee = Number(order.deliveryDetails?.deliveryFee || order.shippingPrice || 0);
      const cashPaid = Number(order.payments?.cash || 0);
      const mpesaPaid = Number(order.payments?.mpesa || 0);
      const totalPaid = (typeof order.amountPaid === 'number' && order.amountPaid > 0)
        ? order.amountPaid
        : (cashPaid + mpesaPaid);
      const balanceDue = (typeof order.balanceDue === 'number')
        ? order.balanceDue
        : Math.max(0, totalAmount - totalPaid);

      // If delivery fee exists, display items subtotal + delivery fee breakdown
      if (deliveryFee > 0) {
        doc.fontSize(7.5).font('Helvetica').fillColor('#6B7280').text('Items Subtotal:', LEFT_X, currentY);
        doc.font('Helvetica-Bold').fillColor('#111827').text(`KES ${itemsSubtotal.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });
        currentY += 11;

        doc.fontSize(7.5).font('Helvetica').fillColor('#6B7280').text('Delivery / Courier Fee:', LEFT_X, currentY);
        doc.font('Helvetica-Bold').fillColor('#111827').text(`KES ${deliveryFee.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });
        currentY += 11;
      }

      // Total Order Value Line
      doc.fontSize(9)
         .font('Helvetica-Bold')
         .fillColor('#000000')
         .text('TOTAL AMOUNT:', LEFT_X, currentY);

      doc.text(`KES ${totalAmount.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });

      currentY += 14;

      // Payment Details & Deposit Lines
      if (isDispatchSlip) {
        doc.fontSize(7.5).font('Helvetica').fillColor('#4B5563').text('Deposit Paid Now:', LEFT_X, currentY);
        doc.font('Helvetica-Bold').fillColor(totalPaid > 0 ? '#10B981' : '#6B7280')
           .text(`KES ${totalPaid.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });

        if (cashPaid > 0 || mpesaPaid > 0) {
          if (cashPaid > 0) {
            currentY += 10;
            doc.font('Helvetica').fontSize(7).fillColor('#6B7280').text('  • Cash Deposit:', LEFT_X, currentY);
            doc.font('Helvetica-Bold').fillColor('#111827').text(`KES ${cashPaid.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });
          }
          if (mpesaPaid > 0) {
            currentY += 10;
            doc.font('Helvetica').fontSize(7).fillColor('#6B7280').text('  • M-Pesa Deposit:', LEFT_X, currentY);
            doc.font('Helvetica-Bold').fillColor('#111827').text(`KES ${mpesaPaid.toLocaleString()}`, RIGHT_X - 70, currentY, { width: 70, align: 'right' });
          }
        }

        // Bold Banner for Balance Due on Delivery
        currentY += 14;
        doc.rect(LEFT_X, currentY, CONTENT_WIDTH, 26).fill('#18181b'); // Dark obsidian banner
        doc.strokeColor('#F59E0B').lineWidth(1.2).rect(LEFT_X, currentY, CONTENT_WIDTH, 26).stroke();

        doc.fontSize(8.5)
           .font('Helvetica-Bold')
           .fillColor('#FBBF24') // Amber gold highlight
           .text(`BALANCE TO PAY ON DELIVERY: KES ${balanceDue.toLocaleString()}`, LEFT_X + 4, currentY + 7, { width: CONTENT_WIDTH - 8, align: 'center' });

        currentY += 32;
      } else {
        // Paid E-Receipt
        doc.fontSize(7.5).font('Helvetica');
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

        currentY += 11;
        doc.font('Helvetica-Bold').fillColor('#10B981').text('BALANCE DUE:', LEFT_X, currentY);
        doc.font('Helvetica-Bold').fillColor('#10B981').text('KES 0 (PAID IN FULL)', RIGHT_X - 100, currentY, { width: 100, align: 'right' });

        currentY += 18;
      }

      // ─────────────────────────────────────────────────────────────────
      // 7. FOOTER & POLICIES
      // ─────────────────────────────────────────────────────────────────
      doc.strokeColor('#D1D5DB')
         .lineWidth(0.5)
         .dash(3, { space: 2 })
         .moveTo(LEFT_X, currentY)
         .lineTo(RIGHT_X, currentY)
         .stroke()
         .undash();

      currentY += 10;

      if (isDispatchSlip) {
        doc.fontSize(7.5)
           .font('Helvetica-Bold')
           .fillColor('#111827')
           .text('PLEASE INSPECT ITEMS & CONFIRM DETAILS', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

        currentY += 11;
        doc.fontSize(6)
           .font('Helvetica')
           .fillColor('#6B7280')
           .text('Verify all items, colors, and sizes with the rider upon arrival.', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

        currentY += 8;
        doc.text('Pay remaining balance via M-Pesa or Cash directly to rider.', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });

        currentY += 10;
        doc.fontSize(6)
           .fillColor('#9CA3AF')
           .text('Official dispatch slip delivered to your WhatsApp • seekonapparel.com', LEFT_X, currentY, { width: CONTENT_WIDTH, align: 'center' });
      } else {
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
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
