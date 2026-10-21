import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';

/**
 * Deterministically derives a 12-digit numeric barcode from a MongoDB ObjectId.
 * Format: 7 + 11 digits (e.g. 751488268715) ensuring universal Code 128 scanner readability.
 */
export const deriveNumericBarcode = (id) => {
  if (!id) return '700000000001';
  const cleanId = String(id).replace(/[^0-9a-fA-F]/g, '');
  const slice = cleanId.slice(-10) || '0';
  const bigVal = BigInt('0x' + slice);
  const numPart = (bigVal % 100000000000n).toString().padStart(11, '0');
  return `7${numPart}`;
};

/**
 * Resolves or assigns the active barcode string for a product document.
 */
export const getProductBarcode = (product) => {
  if (product.barcode && String(product.barcode).trim()) {
    return String(product.barcode).trim();
  }
  if (product.sku && String(product.sku).trim() && !isNaN(product.sku)) {
    return String(product.sku).trim();
  }
  return deriveNumericBarcode(product._id);
};

/**
 * Generates a PNG Buffer of a standard Code 128 barcode using bwip-js.
 */
export const generateCode128Buffer = async (text) => {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text: String(text),
    scale: 3,
    height: 10,
    includetext: false, // Text is custom-styled with PDFKit for razor-sharp typography
    textxalign: 'center'
  });
};

/**
 * Generates an A4 Printable PDF Grid Sheet of Barcode Stickers.
 * 
 * Layout Specs:
 * - Page: Standard ISO A4 (595.28 x 841.89 pt)
 * - Margins: Top 30pt, Bottom 30pt, Left 25pt, Right 25pt
 * - Usable dimensions: 545.28pt x 781.89pt
 * - Grid: 3 columns x 7 rows = 21 stickers per page (Standard retail sticker sheet)
 * - Sticker size: 168pt x 96pt (~59mm x 34mm)
 * - Gaps: X = 14pt, Y = 12pt
 */
export const generateBarcodeSheetPDF = async ({
  items = [],
  title = 'SEEKON APPAREL POS BARCODES',
  sheetSubtitle = 'Standard Code 128 - A4 Printable Template'
}) => {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 25,
        autoFirstPage: false,
        info: {
          Title: title,
          Author: 'Seekon Apparel POS System',
          Subject: 'Product Barcode Sticker Sheet'
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // Grid constants
      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const MARGIN_LEFT = 25;
      const MARGIN_TOP = 40;
      const COLS = 3;
      const ROWS = 7;
      const STICKERS_PER_PAGE = COLS * ROWS; // 21 stickers per page
      const CARD_WIDTH = 168;
      const CARD_HEIGHT = 96;
      const GAP_X = 14.5;
      const GAP_Y = 12;

      // Pre-generate barcode PNG buffers for unique codes to optimize performance
      const barcodeCache = new Map();
      for (const item of items) {
        if (!barcodeCache.has(item.barcode)) {
          try {
            const buf = await generateCode128Buffer(item.barcode);
            barcodeCache.set(item.barcode, buf);
          } catch (err) {
            console.error(`Failed to generate barcode for ${item.barcode}:`, err.message);
          }
        }
      }

      const totalItems = items.length;
      const totalPages = Math.ceil(totalItems / STICKERS_PER_PAGE) || 1;

      for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
        doc.addPage();

        // 1. Header Section
        doc.fontSize(8)
           .font('Helvetica-Bold')
           .fillColor('#111827')
           .text('SEEKON APPAREL', MARGIN_LEFT, 15, { continued: true })
           .font('Helvetica')
           .fillColor('#6B7280')
           .text(` | ${title.toUpperCase()} — Page ${pageIdx + 1} of ${totalPages}`);

        doc.fontSize(6)
           .fillColor('#9CA3AF')
           .text(`${sheetSubtitle} • Generated ${new Date().toLocaleDateString('en-KE')}`, MARGIN_LEFT, 26);

        // Header separator line
        doc.strokeColor('#E5E7EB')
           .lineWidth(0.5)
           .moveTo(MARGIN_LEFT, 33)
           .lineTo(PAGE_WIDTH - MARGIN_LEFT, 33)
           .stroke();

        // 2. Render 3x7 Sticker Grid
        const pageItems = items.slice(pageIdx * STICKERS_PER_PAGE, (pageIdx + 1) * STICKERS_PER_PAGE);

        for (let i = 0; i < pageItems.length; i++) {
          const item = pageItems[i];
          const col = i % COLS;
          const row = Math.floor(i / COLS);

          const x = MARGIN_LEFT + col * (CARD_WIDTH + GAP_X);
          const y = MARGIN_TOP + row * (CARD_HEIGHT + GAP_Y);

          // Sticker Outer Border (Scissor/Peel guide)
          doc.roundedRect(x, y, CARD_WIDTH, CARD_HEIGHT, 4)
             .lineWidth(0.5)
             .strokeColor('#D1D5DB')
             .stroke();

          // Brand tag & Price header inside sticker
          doc.fontSize(6)
             .font('Helvetica-Bold')
             .fillColor('#000000')
             .text('SEEKON', x + 6, y + 6);

          const priceText = item.price ? `KES ${Number(item.price).toLocaleString()}` : '';
          if (priceText) {
            doc.fontSize(7)
               .font('Helvetica-Bold')
               .fillColor('#111827')
               .text(priceText, x + CARD_WIDTH - 65, y + 5, { width: 59, align: 'right' });
          }

          // Product Name (Truncated cleanly to avoid overflow)
          const cleanName = (item.name || 'Seekon Item').slice(0, 26);
          doc.fontSize(7.5)
             .font('Helvetica-Bold')
             .fillColor('#1F2937')
             .text(cleanName, x + 6, y + 17, { width: CARD_WIDTH - 12, height: 10, ellipsis: true });

          // Barcode Image
          const pngBuffer = barcodeCache.get(item.barcode);
          if (pngBuffer) {
            const barcodeW = CARD_WIDTH - 24; // 144pt
            const barcodeH = 42;
            const barcodeX = x + (CARD_WIDTH - barcodeW) / 2;
            const barcodeY = y + 29;

            doc.image(pngBuffer, barcodeX, barcodeY, {
              width: barcodeW,
              height: barcodeH
            });
          }

          // Human-readable code below barcode
          doc.fontSize(7)
             .font('Courier')
             .fillColor('#374151')
             .text(`* ${item.barcode} *`, x, y + 74, {
               width: CARD_WIDTH,
               align: 'center'
             });

          // Category/Tag Footer
          const tagText = item.category || 'Apparel';
          doc.fontSize(5.5)
             .font('Helvetica')
             .fillColor('#9CA3AF')
             .text(tagText.toUpperCase(), x + 6, y + 84, {
               width: CARD_WIDTH - 12,
               align: 'center'
             });
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
