import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Load environment variables
dotenv.config({ path: 'C:/Users/Nextgen/Desktop/seekon-split/seekoon-backend/.env' });

// Output Directory
const baseOutputDir = 'C:/Users/Nextgen/Desktop/seekon-split/video_generator';
const framesDir = path.join(baseOutputDir, 'frames');

// Clean and create frames directory
if (fs.existsSync(framesDir)) {
  fs.readdirSync(framesDir).forEach(file => {
    fs.unlinkSync(path.join(framesDir, file));
  });
} else {
  fs.mkdirSync(framesDir, { recursive: true });
}

// Section-based metadata
const metadata = {
  sections: [
    {
      index: 0,
      narration_text: "We start on Google, searching for our streetwear collection. After clicking the Seekon Apparel result, we navigate straight to the details page of our newly created heavyweight hoodie.",
      frames: []
    },
    {
      index: 1,
      narration_text: "On the product details page, we select our size, medium, choose our color, black, and click add to cart. We then navigate to the cart page and increase our quantity to two, updating the totals automatically.",
      frames: []
    },
    {
      index: 2,
      narration_text: "Next, we proceed to checkout. We fill in our contact details, shipping region, and exact address, then click proceed to payment to route our order.",
      frames: []
    },
    {
      index: 3,
      narration_text: "We review our direct WhatsApp routing information and click Place Order to finalize our purchase. Our order confirmation loads instantly, showing the complete receipt.",
      frames: []
    },
    {
      index: 4,
      narration_text: "Now, let's log in to the admin panel. We input our admin credentials and log in to inspect the backend dashboard.",
      frames: []
    },
    {
      index: 5,
      narration_text: "On the dashboard, we click the notifications bell in the navigation header. We see the unread alert showing our newly placed customer purchase order.",
      frames: []
    },
    {
      index: 6,
      narration_text: "We click the notification, which opens the full Order Details screen. Finally, we update the status dropdown from Pending to Processing, and save the changes.",
      frames: []
    },
    {
      index: 7,
      narration_text: "To verify, we return to the storefront customer profile. Under My Orders, the customer can see their delivery information and order status have been successfully updated to Processing.",
      frames: []
    }
  ]
};

let frameCount = 0;
let currentSectionIndex = 0;

// Capture Frame helper
async function captureFrame(page, sfxType = null) {
  try {
    const filename = `frame_${String(frameCount).padStart(5, '0')}.png`;
    const frameFile = path.join(framesDir, filename);
    await page.screenshot({ path: frameFile, type: 'png' });
    
    // Add frame to the metadata of the current section
    metadata.sections[currentSectionIndex].frames.push({
      file: filename,
      sfx: sfxType
    });
    
    frameCount++;
  } catch (err) {
    console.error('Frame capture failed at frame:', frameCount, err.message);
  }
}

// Custom smooth mouse moving simulation
async function moveCursorTo(page, selector, steps = 15) {
  await page.waitForSelector(selector);
  const rect = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 + window.scrollX,
      y: r.top + r.height / 2 + window.scrollY
    };
  }, selector);

  if (!rect) return;

  const startPos = await page.evaluate(() => {
    let cursor = document.getElementById('virtual-cursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.className = 'virtual-cursor';
      cursor.id = 'virtual-cursor';
      cursor.style.position = 'absolute';
      cursor.style.width = '22px';
      cursor.style.height = '22px';
      cursor.style.background = 'rgba(255, 255, 255, 0.95)';
      cursor.style.border = '2px solid #1e293b';
      cursor.style.borderRadius = '50%';
      cursor.style.pointerEvents = 'none';
      cursor.style.zIndex = '10000000';
      cursor.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
      cursor.style.left = '640px';
      cursor.style.top = '400px';
      document.body.appendChild(cursor);
    }
    return {
      x: parseFloat(cursor.style.left),
      y: parseFloat(cursor.style.top)
    };
  });

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const curX = startPos.x + (rect.x - startPos.x) * ease;
    const curY = startPos.y + (rect.y - startPos.y) * ease;

    await page.evaluate((x, y) => {
      let cursor = document.getElementById('virtual-cursor');
      if (!cursor) {
        cursor = document.createElement('div');
        cursor.className = 'virtual-cursor';
        cursor.id = 'virtual-cursor';
        cursor.style.position = 'absolute';
        cursor.style.width = '22px';
        cursor.style.height = '22px';
        cursor.style.background = 'rgba(255, 255, 255, 0.95)';
        cursor.style.border = '2px solid #1e293b';
        cursor.style.borderRadius = '50%';
        cursor.style.pointerEvents = 'none';
        cursor.style.zIndex = '10000000';
        cursor.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
        document.body.appendChild(cursor);
      }
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    }, curX, curY);

    await captureFrame(page);
  }
}

// Click simulation
async function clickElement(page, selector) {
  await moveCursorTo(page, selector, 15);
  
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      const r = el.getBoundingClientRect();
      const clickX = r.left + r.width / 2 + window.scrollX;
      const clickY = r.top + r.height / 2 + window.scrollY;

      // Render click ripple
      const ripple = document.createElement('div');
      ripple.className = 'puppeteer-click-ripple';
      ripple.style.position = 'absolute';
      ripple.style.width = '30px';
      ripple.style.height = '30px';
      ripple.style.background = 'rgba(0, 166, 118, 0.35)';
      ripple.style.border = '2px solid rgba(0, 166, 118, 0.85)';
      ripple.style.borderRadius = '50%';
      ripple.style.pointerEvents = 'none';
      ripple.style.zIndex = '10000001';
      ripple.style.left = `${clickX - 15}px`;
      ripple.style.top = `${clickY - 15}px`;
      ripple.style.transform = 'scale(0)';
      ripple.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';
      document.body.appendChild(ripple);

      setTimeout(() => {
        ripple.style.transform = 'scale(2.2)';
        ripple.style.opacity = '0';
      }, 10);

      setTimeout(() => ripple.remove(), 300);
      el.click();
    }
  }, selector);

  // Capture ripple frames
  await captureFrame(page, 'click');
  for (let i = 0; i < 6; i++) {
    await captureFrame(page);
  }
}

// Typing simulation (at a normal human speed)
async function typeInElement(page, selector, text) {
  await clickElement(page, selector);
  
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.value = '';
  }, selector);

  await page.focus(selector);

  // Type slowly at normal human speed (~70ms per character)
  for (let char of text) {
    await page.keyboard.sendCharacter(char);
    await sleep(70);
    
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        let cursor = document.getElementById('virtual-cursor');
        if (!cursor) {
          cursor = document.createElement('div');
          cursor.className = 'virtual-cursor';
          cursor.id = 'virtual-cursor';
          cursor.style.position = 'absolute';
          cursor.style.width = '22px';
          cursor.style.height = '22px';
          cursor.style.background = 'rgba(255, 255, 255, 0.95)';
          cursor.style.border = '2px solid #1e293b';
          cursor.style.borderRadius = '50%';
          cursor.style.pointerEvents = 'none';
          cursor.style.zIndex = '10000000';
          cursor.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
          document.body.appendChild(cursor);
        }
        const r = el.getBoundingClientRect();
        cursor.style.left = `${r.left + r.width - 25 + window.scrollX}px`;
        cursor.style.top = `${r.top + r.height / 2 + window.scrollY}px`;
      }
    }, selector);
    
    await captureFrame(page, 'type');
  }
  
  for (let i = 0; i < 5; i++) {
    await captureFrame(page);
  }
}

// Smooth scrolling simulation relative to current scroll position
async function smoothScroll(page, distance, steps = 18) {
  const startScroll = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const currentScroll = startScroll + distance * ease;
    
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, currentScroll);
    
    await captureFrame(page);
  }
}

async function run() {
  let productId = '6a4d6b05b976fea1d9baeb76';
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, { family: 4, serverSelectionTimeoutMS: 6000 });
    const product = await mongoose.connection.db.collection('products').findOne({ name: 'Seekon Aura Heavyweight Hoodie' });
    if (product) {
      productId = product._id.toString();
      console.log('🎯 Found product ID:', productId);
    } else {
      console.log('⚠️ Product not found in database, using fallback');
    }
  } catch (err) {
    console.warn('⚠️ MongoDB Connection failed, using fallback product ID:', err.message);
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  }

  console.log('🎬 Launching Puppeteer browser in Desktop Viewport (1280x800)...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(60000);
  await page.setDefaultTimeout(60000);
  
  // Set Desktop viewport (landscape)
  await page.setViewport({
    width: 1280,
    height: 800,
    deviceScaleFactor: 1.5,
    isMobile: false
  });

  // Inject virtual cursor styling at page load
  await page.evaluateOnNewDocument(() => {
    const style = document.createElement('style');
    style.id = 'virtual-cursor-global-styles';
    style.innerHTML = `
      .virtual-cursor {
        position: absolute;
        width: 22px;
        height: 22px;
        background: rgba(255, 255, 255, 0.95);
        border: 2px solid #1e293b;
        border-radius: 50%;
        pointer-events: none;
        z-index: 10000000;
        box-shadow: 0 3px 8px rgba(0,0,0,0.4);
      }
      .puppeteer-click-ripple {
        position: absolute;
        width: 30px;
        height: 30px;
        background: rgba(0, 166, 118, 0.35);
        border: 2px solid rgba(0, 166, 118, 0.85);
        border-radius: 50%;
        pointer-events: none;
        z-index: 10000001;
        transform: scale(0);
        transition: transform 0.3s ease-out, opacity 0.3s ease-out;
      }
    `;
    document.head.appendChild(style);
  });

  try {
    // ==========================================
    // SECTION 0: Google Search -> Landing
    // ==========================================
    currentSectionIndex = 0;
    console.log('🔍 [SECTION 0] Google search landing...');
    await page.goto('file:///C:/Users/Nextgen/Desktop/seekon-split/video_generator/google_mock.html');
    await sleep(1000);
    await captureFrame(page);
    
    // Click storefront link
    await clickElement(page, 'a.result-title');
    
    // Navigate programmatically to product details page directly
    console.log('🌐 Navigating to product details page...');
    await page.goto(`https://www.seekonapparelglobal.com/product/${productId}`, { waitUntil: 'load' });
    await sleep(1500);

    // ==========================================
    // SECTION 1: Product Selection -> Cart Quantity Update
    // ==========================================
    currentSectionIndex = 1;
    console.log('👕 [SECTION 1] Size & Color selection and Cart Quantity update...');
    await captureFrame(page);

    // Scroll down to options
    await smoothScroll(page, 220, 15);
    await sleep(500);

    // Click Size M
    const sizeBtnSelector = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === 'M');
      if (btn) {
        btn.id = 'product-size-m-btn';
        return '#product-size-m-btn';
      }
      return null;
    });

    if (sizeBtnSelector) {
      await clickElement(page, sizeBtnSelector);
      await sleep(300);
    }

    // Click Color Black
    const colorBtnSelector = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.getAttribute('title') === 'Black');
      if (btn) {
        btn.id = 'product-color-black-btn';
        return '#product-color-black-btn';
      }
      return null;
    });

    if (colorBtnSelector) {
      await clickElement(page, colorBtnSelector);
      await sleep(300);
    }

    // Add to Cart
    const addToCartBtnSelector = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Add to Cart'));
      if (btn) {
        btn.id = 'product-add-to-cart-btn';
        return '#product-add-to-cart-btn';
      }
      return null;
    });

    if (addToCartBtnSelector) {
      await clickElement(page, addToCartBtnSelector);
      await sleep(1200); // Wait for Redux and toast
    }

    // Go to Cart page
    console.log('🛒 Navigating to Cart Page...');
    await page.goto('https://www.seekonapparelglobal.com/cart', { waitUntil: 'load' });
    await sleep(1500);
    await captureFrame(page);

    // Find and Click the plus icon to increase quantity to 2
    const plusBtnSelector = await page.evaluate(() => {
      const borderDiv = document.querySelector('div.flex.items-center.border');
      if (borderDiv) {
        const btns = borderDiv.querySelectorAll('button');
        if (btns.length >= 2) {
          btns[1].id = 'cart-qty-plus-btn';
          return '#cart-qty-plus-btn';
        }
      }
      return null;
    });

    if (plusBtnSelector) {
      await clickElement(page, plusBtnSelector);
      await sleep(1500); // Let total prices update
      await captureFrame(page);
    }

    // ==========================================
    // SECTION 2: Checkout Form details
    // ==========================================
    currentSectionIndex = 2;
    console.log('📝 [SECTION 2] Entering Checkout Delivery Details...');
    
    // Go to Checkout
    const checkoutLinkSelector = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const checkoutLink = links.find(el => el.getAttribute('href') === '/checkout');
      if (checkoutLink) {
        checkoutLink.id = 'cart-checkout-link';
        return '#cart-checkout-link';
      }
      return null;
    });

    if (checkoutLinkSelector) {
      await clickElement(page, checkoutLinkSelector);
    } else {
      await page.goto('https://www.seekonapparelglobal.com/checkout', { waitUntil: 'load' });
    }
    
    await sleep(2000);
    await captureFrame(page);

    // Fill delivery form details
    await typeInElement(page, 'input[type="email"]', 'nimrodkibet376@gmail.com');
    await sleep(300);
    await typeInElement(page, 'input[placeholder="e.g. John"]', 'Nimrod');
    await sleep(300);
    await typeInElement(page, 'input[placeholder="e.g. Doe"]', 'Kibet');
    await sleep(300);
    await typeInElement(page, 'input[placeholder="e.g. 254712345678"]', '0712345678');
    await sleep(500);

    // Select Shipping Region: Nairobi CBD
    await clickElement(page, 'input[value="nairobi_cbd"]');
    await sleep(500);
    await captureFrame(page);

    // Fill Exact Address
    await typeInElement(page, 'input[placeholder*="Enter specific street"]', 'Kimathi Street, Nairobi CBD');
    await sleep(500);

    // Click "Proceed to Payment"
    const proceedPaymentBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Proceed to Payment'));
      if (btn) {
        btn.id = 'proceed-to-payment-btn';
        return '#proceed-to-payment-btn';
      }
      return null;
    });

    if (proceedPaymentBtn) {
      await clickElement(page, proceedPaymentBtn);
      await sleep(1500); // Let layout slide to payment step
    }

    // ==========================================
    // SECTION 3: Payment Routing & Order Confirmed
    // ==========================================
    currentSectionIndex = 3;
    console.log('💳 [SECTION 3] Payment Routing and Finalizing Order...');
    await captureFrame(page);

    // Click Place Order on WhatsApp
    const placeOrderBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Place Order on WhatsApp'));
      if (btn) {
        btn.id = 'place-order-whatsapp-btn';
        return '#place-order-whatsapp-btn';
      }
      return null;
    });

    if (placeOrderBtn) {
      await clickElement(page, placeOrderBtn);
      
      // Wait for confirmation page to load
      await page.waitForFunction(() => {
        return document.body.innerText.includes('Confirmed') || document.body.innerText.includes('Confirmed!');
      }, { timeout: 12000 }).catch(err => {
        console.warn('Timeout waiting for confirmation text, navigating to fallback Success page...');
      });
      
      await sleep(2500); // Let it render completely
      await captureFrame(page);
    }

    // ==========================================
    // SECTION 4: Login to Admin Portal
    // ==========================================
    currentSectionIndex = 4;
    console.log('🔑 [SECTION 4] Logging in as Admin...');
    
    // Navigate to Login page
    await page.goto('https://www.seekonapparelglobal.com/login', { waitUntil: 'load' });
    await sleep(1500);
    await captureFrame(page);

    // Enter login credentials
    await typeInElement(page, '#email', 'nimrodkibet376@gmail.com');
    await sleep(300);
    await typeInElement(page, '#password', 'Nimrod123');
    await sleep(500);

    // Submit form
    const loginSubmitBtn = await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) {
        btn.id = 'admin-login-submit';
        return '#admin-login-submit';
      }
      return null;
    });

    if (loginSubmitBtn) {
      await clickElement(page, loginSubmitBtn);
    }
    
    await sleep(3500); // Wait for redirect to dashboard

    // ==========================================
    // SECTION 5: Open Notifications Bell
    // ==========================================
    currentSectionIndex = 5;
    console.log('🔔 [SECTION 5] Opening notifications from sidebar...');
    await captureFrame(page);

    // Click "Notifications" link in desktop side navigation sidebar
    const notifLinkSelector = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(el => el.textContent.trim().includes('Notifications') || el.getAttribute('href') === '/admin/notifications');
      if (a) {
        a.id = 'admin-notifications-sidebar-link';
        return '#admin-notifications-sidebar-link';
      }
      return null;
    });

    if (notifLinkSelector) {
      await clickElement(page, notifLinkSelector);
    } else {
      await page.goto('https://www.seekonapparelglobal.com/admin/notifications', { waitUntil: 'load' });
    }
    
    await sleep(2500); // Wait for notifications to load
    await captureFrame(page);

    // ==========================================
    // SECTION 6: Order Details and Status Update
    // ==========================================
    currentSectionIndex = 6;
    console.log('📋 [SECTION 6] View order details and update status...');
    await captureFrame(page);

    // Click the top unread order notification card
    const notifCardSelector = await page.evaluate(() => {
      const card = document.querySelector('div.cursor-pointer');
      if (card) {
        card.id = 'new-order-notification-card';
        return '#new-order-notification-card';
      }
      return null;
    });

    if (notifCardSelector) {
      await clickElement(page, notifCardSelector);
      await sleep(3500); // Wait for redirect to Orders details page
      await captureFrame(page);
    }

    // Since the order list is shown, click the first order's view eye icon button
    const eyeBtnSelector = await page.evaluate(() => {
      const btn = document.querySelector('tbody tr td button');
      if (btn) {
        btn.id = 'first-order-view-eye-btn';
        return '#first-order-view-eye-btn';
      }
      return null;
    });

    if (eyeBtnSelector) {
      await clickElement(page, eyeBtnSelector);
      await sleep(2500); // Wait for the drawer to open
      await captureFrame(page);
    }

    // Find status dropdown and change from Pending to Processing
    const selectStatusSelector = await page.evaluate(() => {
      const select = document.querySelector('select[name="status"]') || document.querySelector('select');
      if (select) {
        select.id = 'order-status-select-dropdown';
        return '#order-status-select-dropdown';
      }
      return null;
    });

    if (selectStatusSelector) {
      await clickElement(page, selectStatusSelector);
      await page.select(selectStatusSelector, 'processing');
      await page.evaluate((sel) => {
        document.querySelector(sel).dispatchEvent(new Event('change', { bubbles: true }));
      }, selectStatusSelector);
      await sleep(500);
      await captureFrame(page);
      // Inject IDs for Expected Arrival input, Delivery Details textarea, and Submit button
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const etaInput = inputs.find(el => el.placeholder && el.placeholder.includes('business days'));
        if (etaInput) etaInput.id = 'fulfillment-expected-arrival';
        
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const detailsTextarea = textareas.find(el => el.placeholder && el.placeholder.includes('tracking info'));
        if (detailsTextarea) detailsTextarea.id = 'fulfillment-delivery-details';
        
        const form = document.querySelector('form');
        if (form) {
          const submitBtn = form.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.id = 'fulfillment-submit-btn';
        }
      });

      // Type shipping/tracking details
      await typeInElement(page, '#fulfillment-expected-arrival', 'Tomorrow, 2:00 PM');
      await sleep(300);
      await typeInElement(page, '#fulfillment-delivery-details', 'Driver: John Kamau, Phone: 0722123456, Expected Time: Tomorrow at 2:00 PM');
      await sleep(500);
      await captureFrame(page);

      // Submit tracking details form
      await clickElement(page, '#fulfillment-submit-btn');
      await sleep(2500); // Wait for toast and status update API
      await captureFrame(page);
    }

    // ==========================================
    // SECTION 7: Customer Shop View Delivery Update
    // ==========================================
    currentSectionIndex = 7;
    console.log('📦 [SECTION 7] Customer Shop View Delivery Update verification...');
    
    // Go to my-orders page
    await page.goto('https://www.seekonapparelglobal.com/my-orders', { waitUntil: 'load' });
    await sleep(2500);
    await captureFrame(page);
    
    // Scroll down to display the order status
    await smoothScroll(page, 200, 15);
    await sleep(1000);
    
    // Capture final look frames
    for (let i = 0; i < 50; i++) {
      await captureFrame(page);
      await sleep(50);
    }

    console.log('🏆 All sections successfully simulated.');

  } catch (err) {
    console.error('Fatal error during simulation:', err);
  } finally {
    await browser.close();
  }

  // Write final metadata to JSON
  fs.writeFileSync(path.join(baseOutputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log('📂 Metadata.json generated successfully. Total Frames:', frameCount);
}

run();
