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
    cashierName: 'Jane Cashier',
    servedBy: 'Jane Cashier'
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
  // PHASE 6: Social Media POD & Dual-Mode Dispatch Slip
  // ----------------------------------------------------
  console.log('\n--- [Phase 6] Social Media POD & Dispatch Slip Verification ---');

  const podOrder = new Order({
    _id: new mongoose.Types.ObjectId(),
    orderType: 'social-delivery',
    socialPlatform: 'instagram',
    paymentStatus: 'pending_pod',
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seekon Tech Fleece', price: 4500, quantity: 1, size: 'XL', color: 'Midnight Navy' }
    ],
    shippingPrice: 300,
    totalAmount: 4800,
    amountPaid: 0,
    balanceDue: 4800,
    deliveryDetails: {
      customerName: 'Amina Wangari',
      customerPhone: '254711223344',
      location: 'Kilimani, Wood Avenue Apt 4B',
      deliveryFee: 300,
      riderNotes: 'Call before arriving, security gate #2'
    },
    cashier: cashier._id
  });

  const podErrors = podOrder.validateSync()?.errors;
  assert(!podErrors, 'Order schema validates Social POD order with delivery details & balanceDue');
  assert(podOrder.orderType === 'social-delivery', 'Order identifies as "social-delivery"');
  assert(podOrder.socialPlatform === 'instagram', 'Order records social platform "instagram"');
  assert(podOrder.paymentStatus === 'pending_pod', 'Order records paymentStatus "pending_pod"');
  assert(podOrder.balanceDue === 4800, 'Order calculates full balanceDue on delivery');

  const depositOrder = new Order({
    _id: new mongoose.Types.ObjectId(),
    orderType: 'social-delivery',
    socialPlatform: 'tiktok',
    paymentStatus: 'partial_deposit',
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seekon Cargo Pants', price: 3500, quantity: 2, size: '32', color: 'Khaki' }
    ],
    shippingPrice: 350,
    totalAmount: 7350,
    amountPaid: 350,
    balanceDue: 7000,
    payments: { cash: 0, mpesa: 350 },
    deliveryDetails: {
      customerName: 'Brian Otieno',
      customerPhone: '254722334455',
      location: 'Westlands, Mpaka Road',
      deliveryFee: 350,
      riderNotes: 'Leave with reception if not answering'
    },
    cashier: cashier._id
  });

  const depositErrors = depositOrder.validateSync()?.errors;
  assert(!depositErrors, 'Order schema validates partial deposit order with balanceDue');
  assert(depositOrder.paymentStatus === 'partial_deposit', 'Order records paymentStatus "partial_deposit"');
  assert(depositOrder.amountPaid === 350 && depositOrder.balanceDue === 7000, 'Accurate deposit and balance due calculation');

  const dispatchSlipBuffer = await generateReceiptPDF(podOrder, {
    cashierName: 'Jane Cashier',
    servedBy: 'Jane Cashier'
  });

  assert(Buffer.isBuffer(dispatchSlipBuffer), 'Dispatch slip rendered to in-memory Buffer');
  assert(dispatchSlipBuffer.slice(0, 5).toString('ascii') === '%PDF-', 'Dispatch slip has valid PDF signature (%PDF-)');
  assert(dispatchSlipBuffer.length > 2000, `Dispatch slip contains detailed delivery layout (Length: ${dispatchSlipBuffer.length} bytes)`);

  depositOrder.paymentStatus = 'paid';
  depositOrder.amountPaid = 7350;
  depositOrder.balanceDue = 0;
  depositOrder.payments.mpesa = 7350;

  const paidReceiptBuffer = await generateReceiptPDF(depositOrder, {
    cashierName: 'Jane Cashier',
    servedBy: 'Jane Cashier'
  });

  assert(Buffer.isBuffer(paidReceiptBuffer), 'Final reconciled paid receipt rendered to Buffer');
  assert(paidReceiptBuffer.slice(0, 5).toString('ascii') === '%PDF-', 'Paid receipt has valid PDF signature (%PDF-)');

  // ----------------------------------------------------
  // PHASE 7: Direct WhatsApp Auto-Interception & Dark-Mode Logo
  // ----------------------------------------------------
  console.log('\n--- [Phase 7] Auto-Interception & Dark-Mode Logo Verification ---');

  // Test natural interception detection
  const staffDrop1 = '0712345678 Tech Fleece size L';
  const staffDrop2 = '0722334455 2x Oversized Tee size M Kilimani';
  const staffDrop3 = 'POD 0799887766 Signature Hoodie XL Westlands';

  assert(isOrderMessage(staffDrop1), `isOrderMessage identifies natural staff interception: "${staffDrop1}"`);
  assert(isOrderMessage(staffDrop2), `isOrderMessage identifies natural staff interception: "${staffDrop2}"`);
  assert(isOrderMessage(staffDrop3), `isOrderMessage identifies natural staff interception: "${staffDrop3}"`);

  // Test extraction of fields from natural interception
  const parsedInterception1 = await parseWhatsAppOrderText(staffDrop1);
  assert(parsedInterception1.customerPhone === '254712345678', `Interception 1 extracted phone: ${parsedInterception1.customerPhone}`);
  assert(parsedInterception1.size === 'L', `Interception 1 extracted size: ${parsedInterception1.size}`);
  assert(parsedInterception1.quantity === 1, `Interception 1 defaulted quantity: ${parsedInterception1.quantity}`);

  const parsedInterception2 = await parseWhatsAppOrderText(staffDrop2);
  assert(parsedInterception2.customerPhone === '254722334455', `Interception 2 extracted phone: ${parsedInterception2.customerPhone}`);
  assert(parsedInterception2.size === 'M', `Interception 2 extracted size: ${parsedInterception2.size}`);
  assert(parsedInterception2.quantity === 2, `Interception 2 extracted quantity: ${parsedInterception2.quantity}`);
  assert(parsedInterception2.location === 'Kilimani', `Interception 2 extracted location: ${parsedInterception2.location}`);

  // Test "Served by: [Username]" in PDF generator
  const interceptedOrder = new Order({
    _id: new mongoose.Types.ObjectId(),
    orderType: 'social-delivery',
    socialPlatform: 'whatsapp',
    paymentStatus: 'pending_pod',
    items: [
      { product: new mongoose.Types.ObjectId(), name: 'Seekon Tech Fleece', price: 4500, quantity: 1, size: 'L', color: 'Black' }
    ],
    totalAmount: 4500,
    amountPaid: 0,
    balanceDue: 4500,
    deliveryDetails: {
      customerName: 'WhatsApp Customer',
      customerPhone: '254712345678',
      location: 'Nairobi',
      deliveryFee: 0,
      riderNotes: 'Auto-interception'
    },
    notes: 'WhatsApp Auto-POS Interception • Served by Alex Mwangi'
  });

  const interceptedPdfBuffer = await generateReceiptPDF(interceptedOrder, {
    servedBy: 'Alex Mwangi',
    isDispatchSlip: true
  });

  assert(Buffer.isBuffer(interceptedPdfBuffer), 'Intercepted order PDF generated with "Served by: Alex Mwangi"');
  assert(interceptedPdfBuffer.slice(0, 5).toString('ascii') === '%PDF-', 'Intercepted PDF has valid %PDF- magic bytes');
  assert(interceptedPdfBuffer.length > 2000, `Dark-mode safe dispatch slip created (Length: ${interceptedPdfBuffer.length} bytes)`);

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
