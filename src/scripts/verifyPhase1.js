import mongoose from 'mongoose';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { authorizeRoles } from '../middleware/auth.js';

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

async function runTests() {
  console.log('🧪 Starting Phase 1 Deterministic Verification Suite...\n');

  // ----------------------------------------------------
  // TEST 1: User Model RBAC Schema & Enums
  // ----------------------------------------------------
  console.log('--- Test 1: User Schema Role Enum & Defaults ---');
  
  // Test default role
  const defaultUser = new User({
    name: 'Standard Customer',
    email: 'customer@seekonapparel.com'
  });
  assert(defaultUser.role === 'user', 'Default user role is "user"');

  // Test cashier role
  const cashierUser = new User({
    name: 'Store Cashier',
    email: 'cashier@seekonapparel.com',
    password: 'Password123!',
    role: 'cashier'
  });
  const cashierValidation = cashierUser.validateSync();
  assert(!cashierValidation?.errors?.['role'], 'Cashier role is valid according to User schema enum');

  // Test admin role
  const adminUser = new User({
    name: 'Store Admin',
    email: 'admin@seekonapparel.com',
    password: 'Password123!',
    role: 'admin'
  });
  const adminValidation = adminUser.validateSync();
  assert(!adminValidation?.errors?.['role'], 'Admin role is valid according to User schema enum');

  // Test illegal role rejection
  const invalidUser = new User({
    name: 'Attacker',
    email: 'hacker@example.com',
    role: 'super_hacker'
  });
  const invalidValidation = invalidUser.validateSync();
  assert(
    invalidValidation && invalidValidation.errors['role'],
    'User schema strictly rejects unauthorized roles (e.g., "super_hacker")'
  );

  // ----------------------------------------------------
  // TEST 2: Order Model Split Payments & Walk-in Schema
  // ----------------------------------------------------
  console.log('\n--- Test 2: Order Schema Split Payments & Source ---');

  const splitOrder = new Order({
    items: [{
      product: new mongoose.Types.ObjectId(),
      name: 'Seekon Signature Hoodie',
      price: 5000,
      quantity: 1,
      color: 'Black',
      image: 'hoodie.jpg'
    }],
    totalAmount: 5000,
    paymentMethod: 'Split',
    payments: {
      cash: 2000,
      mpesa: 3000
    },
    orderSource: 'pos',
    cashier: cashierUser._id
  });

  const splitValidation = splitOrder.validateSync();
  assert(!splitValidation, 'Order schema accepts valid Split payment with cash & mpesa components');
  assert(splitOrder.payments.cash === 2000, 'Cash split payment stored accurately: 2000');
  assert(splitOrder.payments.mpesa === 3000, 'M-Pesa split payment stored accurately: 3000');
  assert(splitOrder.orderSource === 'pos', 'Order source recognized as "pos"');

  // Test negative payment amounts rejection
  const negativeCashOrder = new Order({
    paymentMethod: 'Split',
    payments: {
      cash: -500,
      mpesa: 2000
    }
  });
  const negativeCashValidation = negativeCashOrder.validateSync();
  assert(
    negativeCashValidation && negativeCashValidation.errors['payments.cash'],
    'Order schema rejects negative split cash amounts'
  );

  const negativeMpesaOrder = new Order({
    paymentMethod: 'Split',
    payments: {
      cash: 500,
      mpesa: -2000
    }
  });
  const negativeMpesaValidation = negativeMpesaOrder.validateSync();
  assert(
    negativeMpesaValidation && negativeMpesaValidation.errors['payments.mpesa'],
    'Order schema rejects negative split mpesa amounts'
  );

  // ----------------------------------------------------
  // TEST 3: RBAC Middleware (authorizeRoles) Execution
  // ----------------------------------------------------
  console.log('\n--- Test 3: authorizeRoles Middleware Execution ---');

  const posAuth = authorizeRoles('admin', 'cashier');

  // Case 3a: Cashier Accessing POS -> Allowed
  let nextCalled = false;
  let resStatus = null;
  let resJson = null;

  const mockRes = () => ({
    status: (code) => {
      resStatus = code;
      return {
        json: (data) => {
          resJson = data;
        }
      };
    }
  });

  await posAuth(
    { user: { _id: '123', role: 'cashier', email: 'cashier@seekonapparel.com' } },
    mockRes(),
    () => { nextCalled = true; }
  );
  assert(nextCalled === true, 'authorizeRoles allows cashier access');

  // Case 3b: Admin Accessing POS -> Allowed
  nextCalled = false;
  await posAuth(
    { user: { _id: '456', role: 'admin', email: 'admin@seekonapparel.com' } },
    mockRes(),
    () => { nextCalled = true; }
  );
  assert(nextCalled === true, 'authorizeRoles allows admin access');

  // Case 3c: Regular User Accessing POS -> Denied (403 Forbidden)
  nextCalled = false;
  resStatus = null;
  resJson = null;
  await posAuth(
    { user: { _id: '789', role: 'user', email: 'customer@example.com' } },
    mockRes(),
    () => { nextCalled = true; }
  );
  assert(nextCalled === false, 'authorizeRoles blocks standard user access');
  assert(resStatus === 403, 'authorizeRoles returns HTTP 403 Forbidden for unauthorized roles');

  // Case 3d: Unauthenticated Access -> Denied (401 Unauthorized)
  nextCalled = false;
  resStatus = null;
  await posAuth(
    {},
    mockRes(),
    () => { nextCalled = true; }
  );
  assert(nextCalled === false && resStatus === 401, 'authorizeRoles returns HTTP 401 Unauthorized when req.user is absent');

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log(`\n========================================`);
  console.log(`Phase 1 Verification Complete: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
