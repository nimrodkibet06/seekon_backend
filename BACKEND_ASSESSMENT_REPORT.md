# ⚜️ SEEKON APPAREL BACKEND ASSESSMENT REPORT
**Detailed Technical Evaluation & Architectural Assessment**

---

## 1. Executive Summary

This document provides a comprehensive technical assessment of the **Seekon Apparel Backend API**, a modern, production-grade e-commerce server built to support a premium streetwear storefront. 

The backend is developed using **Node.js (ES Modules)** and the **Express** framework, leveraging **MongoDB** (via Mongoose) as the primary data store. It includes integrations for local and international payment gateways, AI-driven customer assistants, background job queues, automatic database backups, automated WhatsApp notification pipelines, and advanced security protections.

### 🛠️ Core Technology Stack
*   **Runtime Environment**: Node.js (with ES Module support (`"type": "module"`))
*   **Web Framework**: Express.js
*   **Database & ODM**: MongoDB & Mongoose
*   **Queue Management**: BullMQ & Redis
*   **Payment Gateways**: Safaricom M-Pesa (Daraja API), Paystack, Flutterwave
*   **AI Integration**: Groq SDK (Llama-3.3-70b-versatile model)
*   **Messaging**: `whatsapp-web.js` (Puppeteer automation)
*   **Image Processing**: Sharp & `@imgly/background-removal-node`
*   **Mailing Service**: Resend API & Nodemailer
*   **Storage Provider**: Cloudinary (with Multer Storage integration)
*   **Process Management**: PM2 (via `ecosystem.config.cjs`)

---

## 2. System Architecture & Directory Structure

The codebase adheres to a structured **Controller-Service-Route** design pattern, keeping concerns clean, modular, and easy to maintain.

```
seekoon-backend/
 ├── src/
 │    ├── config/           # Database, Cloudinary, Redis, and WhatsApp bot initializations
 │    ├── controllers/      # Route handler logic and business computations
 │    ├── middleware/       # Authentication, rate limiting, file upload configurations
 │    ├── models/           # Mongoose schemas (14 core schemas)
 │    ├── queues/           # BullMQ job queue definitions
 │    ├── routes/           # Express API endpoints grouped by resource
 │    ├── scripts/          # Cron jobs, database seeding, and manual operations scripts
 │    ├── services/         # Image workers, backups, and Google Drive integrations
 │    ├── utils/            # Email templates, web push helpers
 │    └── server.js         # Entrypoint file loading envs, initializing crons, starting listener
 ├── .env.example           # Reference environment configuration
 ├── package.json           # Scripts, metadata, and production/development dependencies
 ├── SmartSeed.js           # Smart DB seeder script
 └── migrate-images.js      # Script to download, strip backgrounds, compress, and upload images
```

---

## 3. Deep-Dive Feature Analysis

### 🔐 Authentication & Identity Management
The backend implements a multi-channel authentication model (Local & Social) with advanced user-merging capabilities.

*   **JWT Tokens**: Secure stateless token issuance via `jsonwebtoken` with varying expiration policies (remember-me support: 24h to 7 days).
*   **Google OAuth2**: Integrated via `google-auth-library` (`OAuth2Client`). Users can register or log in seamlessly.
*   **Guest Checkout Order Claiming**: If an unauthenticated guest user performs a checkout using a valid email, their orders are registered as guest checkouts. Upon registering for a full account with that same email (locally or via Google), the system runs an asynchronous update query `Order.updateMany({ guestEmail: email, isGuestCheckout: true }, { user: newUser._id, isGuestCheckout: false })`, claiming all past guest orders for the new user profile.
*   **Inline Verification Codes (OTPs)**: Secure, timed 6-digit verification codes sent via the mailing pipeline to verify registrations.
*   **Disposable Email Defense**: Checks both user registrations (`authController.js`) and guest checkouts (`orderController.js`) against a blocklist of temporary email providers (`disposable-email-blocklist`) to prevent dummy orders and fake accounts.

---

### 💳 Integrated Payment Gateways
The payment infrastructure handles mobile money, local bank transfers, and international credit cards.

```
                       ┌─────────────────────────┐
                       │      User Checkout      │
                       └────────────┬────────────┘
                                    │
                         Select Payment Method
                                    │
             ┌──────────────────────┼──────────────────────┐
             ▼                      ▼                      ▼
      ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
      │    M-Pesa    │       │   Paystack   │       │ Flutterwave  │
      │ (Daraja STK) │       │ (Verify API) │       │  (Redirect)  │
      └──────┬───────┘       └──────┬───────┘       └──────┬───────┘
             │                      │                      │
      Daraja Callback       Verify Reference       Flutterwave Callback
             │                      │                      │
             └──────────────────────┼──────────────────────┘
                                    │
                                    ▼
                         Result Code == Success?
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
                     [ Yes ]                 [ No ]
                        │                       │
              ┌─────────┴─────────┐   ┌─────────┴─────────┐
              │  Mark Order Paid  │   │ Mark Transaction  │
              │  Decrement Stock  │   │      Failed       │
              │  Clear User Cart  │   └───────────────────┘
              │  Schedule Backup  │
              └───────────────────┘
```

#### 1. Safaricom M-Pesa (Daraja API)
*   **STK Push Initiation**: Sanitizes and formats phone numbers (supporting local `07...` or international format `254...`). Generates base64 OAuth tokens against `https://sandbox.safaricom.co.ke` (or live `api.safaricom.co.ke`). Initiates `CustomerPayBillOnline` processes.
*   **Webhook Callback**: Validates incoming STK Push payments from Safaricom. On success, it flags the order as paid, decrements inventory, issues internal admin alerts, and clears the user's cart.
*   **M-Pesa Cron Sync**: To protect against missed webhooks (common with mobile network latency), `initMpesaSyncCron` executes every 15 minutes (`stkQueryCron.js`). It fetches all orders with `isPaid: false`, `status: pending`, and an existing checkout request ID created between 5 minutes and 24 hours ago. It queries Safaricom's Query API directly and auto-reconciles stuck orders:
    *   `ResultCode: "0"` -> Marks as Paid, updates inventory, creates a transaction record, clears cart, and schedules backup.
    *   Definitive Failure Codes (`1032` Cancelled, `1037` Timeout, etc.) -> Updates order status to `failed`.

#### 2. Paystack Integration
*   Allows initializing transactions, converting prices from KES to Kobo/cents (multiplied by 100). Employs safe server-side verification lookup (`/paystack/verify`) verifying metadata and payment success, decrementing inventory, and cleaning the user's cart on completion.

#### 3. Flutterwave Integration
*   Leverages `flutterwave-node-v3` to create hosted checkout links, handling redirects, verifying transactions via transaction IDs, and completing the order pipeline in a headless webhook context (ensuring cart clearance is fetched from the DB Order object rather than HTTP request headers).

---

### 🤖 AI-Powered Shopping Assistant
The backend provides an AI agent endpoint (`/api/ai`) using Groq's low-latency Llama-3.3-70b-versatile model.

*   **Function Tool Calling**: Employs structural tool configurations allowing the model to decide when to call the `searchDatabase` function to look up products based on user prompts.
*   **Fuzzy Matching / Typo Tolerance**: When the AI triggers a search query, the backend splits the query characters and connects them with wildcard operators (e.g. `nkie` -> `n.*k.*i.*e`) to execute a regex-based fuzzy search on product names, brands, and tags. It handles spelling variations automatically.
*   **Hallucination Prevention**: If a search yields 0 products, the system queries Mongoose for 3 active alternative products and feeds them back as tool context. This prevents the LLM from hallucinating mock items and guarantees it suggests real inventory.
*   **Deep Linking**: Instructs the assistant to format output items in KSh and output hyperlinks in the exact format: `[Product Name](/product/{id})` for direct redirection.

---

### 📥 Background Worker Queue & Image Processing
High-overhead operations are moved to background workers so they don't block Express routing.

*   **BullMQ + Redis Worker**: Runs on a separate worker node or concurrent thread (`src/workers/imageWorker.js`), ensuring Express handles API traffic unimpeded.
*   **Dual-Mode Background Removal**:
    *   **Mode A (Cloud API)**: If `REMOVE_BG_API_KEY` is present, it issues a rapid base64 API request to remove.bg, saving local CPU and RAM.
    *   **Mode B (Local AI)**: If no key is set, it loads `@imgly/background-removal-node` locally to perform background removal in the background queue.
*   **Sharp Compression**: Converts raw uploads to optimized WebP format with `quality: 80` and resizes them to fit within a `1200x1200px` frame.
*   **Storage & DB Linking**: Uploads processed WebP images to Cloudinary, deletes temporary filesystem copies, sets the Product status to `active`, and assigns image links to the MongoDB document.

---

### 💾 Automated Google Drive Database Backup
A robust backup system is embedded directly into the application server, avoiding complex system-level cron installations.

*   **Dynamic Discovery**: Rather than relying on static arrays, `backupService.js` queries Mongoose (`mongoose.connection.db.listCollections()`) to fetch and crawl all collection data dynamically, exporting the entire database state as an structured JSON backup.
*   **Debounced Executions**: Instead of backing up on every purchase (which strains DB resources during sales), successful checkout callbacks call a debounced scheduling function. The backup starts only when the system has been idle for 5 minutes (`DEBOUNCE_MS`).
*   **Pruning & Retention**: The service fetches Google Drive items matching prefix criteria (`seekon_backup_`), pages through results using page tokens, calculates Cutoffs based on `BACKUP_RETENTION_DAYS` (default: 30), and moves expired backups to the trash (`trashed: true`) to bypass file ownership limits.

---

### 📱 Headless WhatsApp Notification Bot
Automates customer messaging using the WhatsApp Web client protocol via `whatsapp-web.js` & Puppeteer.

*   **Resource & RAM Conservation**: Running headless Chromium on tiny cloud VMs (like Railway) frequently causes memory exhaustion. The bot counters this with:
    1.  **Request Interception**: Aborts all Puppeteer downloads for `image`, `media`, and `font` resources in the background WhatsApp Web page, reducing bandwidth and CPU usage.
    2.  **Forced Garbage Collection**: Runs page-level and process-level garbage collection (`window.gc()` and `global.gc()`) every 30 minutes to clean up chromium and V8 heap leakages.
*   **Dynamic QR Generation**: Outputs terminal QR codes and exposes `/api/admin/bot-status` containing raw QR string representations. This allows the storefront admin panel to render the QR code, enabling administrators to scan and link their WhatsApp account.
*   **Offline Notifications**: If the bot loses connection, it triggers an email alert (`sendAdminOfflineAlertEmail`) to notify the administrator.
*   **Robust Delivery**: Formats number inputs, handles self-messaging (`"me"` or `"self"` targets), and wraps sending promises with a 60-second timeout to prevent thread blocks.

---

## 4. Database Schema Design (14 Core Models)

The data layer is fully indexed and designed with references to handle complex e-commerce logic.

| Schema | File | Primary Purpose | Key Fields & Configuration |
| :--- | :--- | :--- | :--- |
| **User** | `User.js` | Customer accounts & profiles | `email` (unique), `password`, `isGuest`, `googleId` (unique, sparse), `authProvider` (local/google), `role` (user/admin), `cart`, `wishlist`, `isActive`, `pushSubscription` |
| **Admin** | `Admin.js` | Admin credentials & permissions | `username`, `email` (unique), `password`, `role` (admin, superadmin), `lastLogin` |
| **Product** | `Product.js` | Item catalogs, attributes & reviews | `name`, `price`, `originalPrice`, `discount`, `images`, `status`, `category`, `sizes`, `colors`, `stock`, `sold`, `reviewDetails`, `isFlashSale` |
| **Order** | `Order.js` | Order details & payment tracking | `user`, `isGuestCheckout`, `items` (embedded snapshot), `totalAmount`, `paymentMethod`, `shippingAddress`, `status`, `isPaid` |
| **Transaction** | `Transaction.js`| Financial ledger & gateway callbacks| `userEmail`, `phoneNumber`, `method` (mpesa, paystack, flw), `amount`, `status`, `reference` (unique), `callbackData` (mixed) |
| **Cart** | `Cart.js` | Active shopping sessions | `userId`, `items` (product ID, quantity, size, color), `totalItems`, `totalPrice` |
| **Wishlist** | `Wishlist.js` | User bookmark lists | `userId`, `items` (array of product IDs) |
| **Coupon** | `Coupon.js` | Promotional discounts | `code` (unique, uppercase), `discountType` (percentage/fixed), `discountAmount`, `expiryDate`, `isActive`, `maxUses`, `usedCount` |
| **Notification** | `Notification.js`| System & order status logs | `type` (INFO, SYSTEM, NEW_ORDER, LOW_STOCK), `message`, `orderId`, `isRead` |
| **SystemLog** | `SystemLog.js` | Administrative audit trail | `action` (user_login, settings_updated, etc.), `actor`, `actorType`, `details` (mixed), `ipAddress`, `severity`, `module` |
| **Setting** | `Setting.js` | Dynamic configuration values | `key` (unique), `value` (mixed), `description` |
| **Subscriber** | `Subscriber.js`| Newsletter mail subscribers | `email` (unique, lowercase), `status` (subscribed/unsubscribed) |
| **Category** | `Category.js` | Category hierarchy | `name` (unique), `slug` (unique), `description`, `parentCategory` (self-reference) |
| **Brand** | `Brand.js` | Brand information | `name` (unique), `description`, `logo` |

---

## 5. Security & Performance Implementations

### 🛡️ Security Protections
1.  **Rate Limiting**: Custom rate limiting applied globally to protect routes. Strict limits on auth and payment initialization (`paymentLimiter` allows max 5 requests per 15 minutes per IP).
2.  **Header Protections**: Helmet middleware configured with cross-origin policies to prevent content sniffing and clickjacking, without blocking client storefront requests.
3.  **Strict Data Sanitization**: Express validators sanitize fields on incoming payloads. The server trusts proxies (`app.set('trust proxy', 1)`) to ensure client IP tracking is accurate behind load balancers.
4.  **Price Tampering Prevention**: The checkout endpoint rejects prices passed from the client payload. Instead, it extracts the product IDs, queries the database directly to fetch verified prices, calculates the subtotal, adds shipping, and saves the final calculated price.

### ⚡ Performance Optimizations
1.  **Event Loop Offloading**: High-overhead tasks (such as Puppeteer interactions and image processing) are deferred to BullMQ queues, keeping the Express server responsive to client requests.
2.  **Memory Management**: Headless Chromium and node processes are configured to use explicit garbage collection flags (`node --expose-gc`). Cron jobs trigger manual cleanups every 15 minutes to reclaim V8 heap memory.
3.  **Database Indexing**: The `SystemLog` model indexes `createdAt`, `action`, and `actor` to keep audit logs fast even as logs accumulate.

---

## 6. Recommendations & Action Items

The codebase is highly resilient, but the following enhancements are recommended to improve scalability:

### 1. Database Indexing
Add indexes to fields queried frequently in filters and search loops:
*   `Product.js`: Index `category`, `status`, and `isFlashSale`.
*   `Order.js`: Index `user`, `status`, and `mpesaCheckoutRequestId`.

### 2. WhatsApp Session Management
Currently, the WhatsApp bot uses `LocalAuth` with local file storage. If the backend is deployed to a serverless platform with ephemeral filesystems (like Railway without persistent volumes or Vercel), the session folder will be deleted on redeployments, requiring admins to re-scan the QR code.

**Solution**: Ensure a Railway Persistent Volume is mounted to `/data`, or migrate to a remote session storage auth strategy.

### 3. Log Rotation
The database audit log (`SystemLog`) logs administrative and customer events. Over time, this collection will grow.

**Recommendation**: Set up a clean-up script or convert `SystemLog` into a capped collection, or implement an archival cron job.

---
*Report compiled on:* **June 30, 2026**  
*Compiled by:* **Antigravity AI**
