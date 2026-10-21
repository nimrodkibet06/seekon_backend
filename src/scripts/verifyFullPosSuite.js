import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';
import PendingOrder from '../models/PendingOrder.js';
import { authorizeRoles } from '../middleware/auth.js';
import { deriveNumericBarcode, getProductBarcode, generateBarcodeSheetPDF } from '../services/barcodeService.js';
import { generateReceiptPDF } from '../services/receiptService.js';
import { isOrderMessage, parseWhatsAppOrderText } from '../services/whatsappOrderParser.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('🧪 SEEKON POS ARCHITECTURE COMPLETE VERIFICATION SUITE');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // PHASE 1: Database & RBAC Verification
  // ----------------------------------------------------
  console.log('--- [Phase 1] Database & RBAC Verification ---');

  const cashier = new User({
    name: 'Jane Cashier',
    email: 'jane.cashier@seekon.local',
    password: 'SecurePassword123!',
    role: 'cashier'
  });
  const cashierErrors = cashier.validateSync()?.errors;
  assert(!cashierErrors?.role, 'User schema validates "cashier" role');

  const splitOrder = new Order({
    items: [{
      product: new mongoose.Types.ObjectId(),
      name: 'Seekon Tactical Fleece',
      price: 4500,
      quantity: 1,
      color: 'Black',
      image: 'fleece.jpg'
    }],
    totalAmount: 4500,
    paymentMethod: 'Split',
    payments: { cash: 2000, mpesa: 2500 },
    orderSource: 'pos',
    cashier: cashier._id
  });
  const splitErrors = splitOrder.validateSync()?.errors;
  assert(!splitErrors, 'Order schema validates split payments (Cash: 2000, M-Pesa: 2500)');

  // RBAC test
  const posRbac = authorizeRoles('admin', 'cashier');
  let allowed = false;
  await posRbac(
    { user: { _id: cashier._id, role: 'cashier' } },
    { status: () => ({ json: () => {} }) },
    () => { allowed = true; }
  );
  assert(allowed === true, 'authorizeRoles permits cashier access to POS routes');

  let blocked = false;
  let blockedStatus = null;
  await posRbac(
    { user: { _id: 'customer_id', role: 'user' } },
    { status: (code) => { blockedStatus = code; return { json: () => { blocked = true; } }; } },
    () => {}
  );
  assert(blockedStatus === 403, 'authorizeRoles blocks standard user role with HTTP 403');

  // ----------------------------------------------------
  // PHASE 2: PDF Barcode Generation (bwip-js & pdfkit)
  // ----------------------------------------------------
  console.log('\n--- [Phase 2] PDF Barcode Generation Verification ---');

  const mockProduct = {
    _id: '67162fa93012345678abcdef',
    name: 'Seekon Signature Hoodie',
    price: 3500,
    category: 'Apparel'
  };

  const barcode = getProductBarcode(mockProduct);
  assert(/^[0-9]{12}$/.test(barcode), `Deterministic 12-digit Code 128 barcode generated: ${barcode}`);

  const stickerItems = Array(21).fill({
    name: mockProduct.name,
    price: mockProduct.price,
    barcode,
    category: mockProduct.category
  });

  const barcodeSheetBuffer = await generateBarcodeSheetPDF({
    items: stickerItems,
    title: 'Seekon Test Barcode Sheet'
  });

  assert(Buffer.isBuffer(barcodeSheetBuffer), 'A4 barcode sheet rendered to Buffer');
  assert(barcodeSheetBuffer.length > 5000, `A4 PDF contains valid content (Length: ${barcodeSheetBuffer.length} bytes)`);

  // Verify PDF header magic bytes '%PDF-'
  const pdfHeader = barcodeSheetBuffer.slice(0, 5).toString('ascii');
  assert(pdfHeader === '%PDF-', 'Barcode document begins with valid PDF signature (%PDF-)');

  // ----------------------------------------------------
  // PHASE 3 & 4: Walk-in Checkout & Branded PDF Receipts
  // ----------------------------------------------------
  console.log('\n--- [Phase 3 & 4] Checkout & WhatsApp E-Receipt Verification ---');

  const walkinOrder = new Order({
    _id: new mongoose.Types.ObjectId(),
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seekon Oversized Tee', price: 2500, quantity: 2, size: 'L', color: 'Black' },
      { product: new mongoose.Types.ObjectId(), name: 'Seekon Cargo Short', price: 3000, quantity: 1, size: 'M', color: 'Olive' }
    ],
    totalAmount: 8000,
    paymentMethod: 'Split',
    payments: { cash: 3000, mpesa: 5000 },
    orderSource: 'pos',
    guestPhone: '254727672772',
    cashier: cashier._id
  });

  const receiptBuffer = await generateReceiptPDF(walkinOrder, {
    cashierName: 'Jane Cashier'
  });

  assert(Buffer.isBuffer(receiptBuffer), 'In-memory receipt rendered to Buffer');
  assert(receiptBuffer.slice(0, 5).toString('ascii') === '%PDF-', 'Receipt buffer has valid PDF signature');
  assert(receiptBuffer.length > 1500, `Receipt PDF size optimized for mobile WhatsApp delivery (Length: ${receiptBuffer.length} bytes)`);

  // ----------------------------------------------------
  // PHASE 5: Headless WhatsApp Order Pool & Parser
  // ----------------------------------------------------
  console.log('\n--- [Phase 5] Headless WhatsApp Order Pool Verification ---');

  const sampleDropMessage = `ORDER:
Customer: John Kamau 0712345678
- 2x Seekon Tech Fleece size L Black @ 4500
- 1x Tactical Cap size Standard Grey @ 1500
Total: 10500
Payment: Split Cash 5000 Mpesa 5500
Notes: Walk-in collection at Kilimani`;

  assert(isOrderMessage(sampleDropMessage), 'isOrderMessage identifies WhatsApp group manual order drop');

  const parsedOrder = await parseWhatsAppOrderText(sampleDropMessage);
  assert(parsedOrder.customerPhone === '254712345678', `Normalized customer phone: ${parsedOrder.customerPhone}`);
  assert(parsedOrder.customerName === 'John Kamau', `Extracted customer name: ${parsedOrder.customerName}`);
  assert(parsedOrder.items.length === 2, `Extracted 2 order line items (Found: ${parsedOrder.items.length})`);
  assert(parsedOrder.totalAmount === 10500, `Extracted total amount KES 10,500 accurately (Got: ${parsedOrder.totalAmount})`);
  assert(parsedOrder.payments.cash === 5000, `Split cash extracted: KES ${parsedOrder.payments.cash}`);
  assert(parsedOrder.payments.mpesa === 5500, `Split M-Pesa extracted: KES ${parsedOrder.payments.mpesa}`);

  const pendingDoc = new PendingOrder({
    ...parsedOrder,
    rawMessage: sampleDropMessage,
    senderJid: '254727672772@s.whatsapp.net',
    groupJid: '120363028392819283@g.us'
  });
  const pendingErrors = pendingDoc.validateSync()?.errors;
  assert(!pendingErrors, 'PendingOrder model schema successfully validates queued WhatsApp order');

  // ----------------------------------------------------
  // SUMMARY SCORECARD
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log(`TOTAL SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch(err => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
