import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
      narration_text: "Welcome to the Seekon Apparel admin tutorial. First, let's search for Seekon Apparel on Google. We find the official storefront link and click it to open the home page.",
      frames: []
    },
    {
      index: 1,
      narration_text: "On the storefront home page, we open the mobile navigation menu and select the login link to access the administrative portal.",
      frames: []
    },
    {
      index: 2,
      narration_text: "Next, we enter our administrator email and password, check the remember me box, and submit the login form to authenticate.",
      frames: []
    },
    {
      index: 3,
      narration_text: "Once logged in, the admin dashboard appears. We open the side navigation drawer and click Add Product to begin adding our new streetwear garment.",
      frames: []
    },
    {
      index: 4,
      narration_text: "We enter the product name, Seekon Aura Heavyweight Hoodie, and click the Auto-Generate button to let our integrated AI write a premium description for us.",
      frames: []
    },
    {
      index: 5,
      narration_text: "We select Apparel as the category, Seekon as the brand, and Hoodies as the subcategory. We then set the pricing and stock, and toggle our size and color options.",
      frames: []
    },
    {
      index: 6,
      narration_text: "Now, we click Add Single Image to open our device's local file manager, select our high-resolution streetwear hoodie mock photo, and upload it to the form.",
      frames: []
    },
    {
      index: 7,
      narration_text: "With all fields complete, we scroll down and click submit. The product uploads in the background and is saved directly to our database.",
      frames: []
    },
    {
      index: 8,
      narration_text: "To verify, we open the menu and click Shop View. Scrolling down the storefront, we can see our newly added hoodie is live and ready for customers to purchase immediately.",
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
      cursor.style.left = '187px';
      cursor.style.top = '406px';
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

  // Type slowly at normal human speed (~100ms per character)
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
  console.log('🎬 Launching Puppeteer browser in mobile viewport...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Set exact iPhone X viewport
  await page.setViewport({
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
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
    // SECTION 0: Search & Landing
    // ==========================================
    currentSectionIndex = 0;
    console.log('🔍 [SECTION 0] Google mock search page...');
    await page.goto('file:///C:/Users/Nextgen/Desktop/seekon-split/video_generator/google_mock.html');
    await sleep(1000);
    await captureFrame(page);
    
    // Move to storefront link and click
    await clickElement(page, 'a.result-title');
    
    // Programmatically navigate to the live website
    console.log('🌐 Programmatically navigating to live site...');
    await page.goto('https://www.seekonapparelglobal.com/', { waitUntil: 'networkidle2' });

    // ==========================================
    // SECTION 1: Storefront Landing
    // ==========================================
    currentSectionIndex = 1;
    console.log('🏠 [SECTION 1] Storefront home landing...');
    await captureFrame(page);
    
    // Scroll down and up
    await smoothScroll(page, 300, 15);
    await sleep(500);
    await smoothScroll(page, -300, 15);
    await sleep(500);

    // Inject hamburger button selector helper
    const menuBtnSelector = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.querySelector('svg') && el.className.includes('md:hidden'));
      if (btn) {
        btn.id = 'mobile-menu-toggle-btn';
        return '#mobile-menu-toggle-btn';
      }
      return null;
    });

    if (menuBtnSelector) {
      await clickElement(page, menuBtnSelector);
      await sleep(1000); // Let the drawer slide open
    } else {
      console.warn('Mobile menu button not found, navigating directly to login...');
    }

    // Move to and click LOGIN link in mobile menu drawer
    const loginLinkSelector = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(el => el.textContent.trim().toUpperCase() === 'LOGIN');
      if (a) {
        a.id = 'mobile-menu-login-link';
        return '#mobile-menu-login-link';
      }
      return null;
    });

    if (loginLinkSelector) {
      await clickElement(page, loginLinkSelector);
    } else {
      await page.goto('https://www.seekonapparelglobal.com/login');
    }
    
    await sleep(2000); // Let login page load

    // ==========================================
    // SECTION 2: Account Login
    // ==========================================
    currentSectionIndex = 2;
    console.log('🔑 [SECTION 2] Account Login...');
    await captureFrame(page);

    // Enter email and password slowly
    await typeInElement(page, '#email', 'nimrodkibet376@gmail.com');
    await sleep(500);
    await typeInElement(page, '#password', 'Nimrod123');
    await sleep(500);

    // Submit form
    const loginSubmitBtn = await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) {
        btn.id = 'login-submit-btn';
        return '#login-submit-btn';
      }
      return null;
    });

    if (loginSubmitBtn) {
      await clickElement(page, loginSubmitBtn);
    }
    
    await sleep(3500); // Wait for API response and redirect to dashboard

    // ==========================================
    // SECTION 3: Admin Dashboard Navigation
    // ==========================================
    currentSectionIndex = 3;
    console.log('📊 [SECTION 3] Admin Dashboard navigation...');
    await captureFrame(page);

    // Open admin layout mobile sidebar drawer
    const adminMenuBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.className.includes('lg:hidden') && el.querySelector('svg'));
      if (btn) {
        btn.id = 'admin-menu-toggle-btn';
        return '#admin-menu-toggle-btn';
      }
      return null;
    });

    if (adminMenuBtn) {
      await clickElement(page, adminMenuBtn);
      await sleep(1000); // Let sidebar open
    }

    // Click "Add Product" link in sidebar
    const addProductLink = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find(el => el.textContent.trim().includes('Add Product'));
      if (a) {
        a.id = 'admin-sidebar-add-product-link';
        return '#admin-sidebar-add-product-link';
      }
      return null;
    });

    if (addProductLink) {
      await clickElement(page, addProductLink);
      await sleep(500);
      
      // Close the mobile sidebar drawer so it doesn't block the Add Product form!
      console.log('🚪 Closing admin sidebar drawer...');
      await page.evaluate(() => {
        const backdrop = Array.from(document.querySelectorAll('div')).find(el => el.className.includes('bg-black/60') && el.className.includes('z-30'));
        if (backdrop) {
          backdrop.click();
        } else {
          const closeBtn = Array.from(document.querySelectorAll('button')).find(el => el.querySelector('svg') && el.closest('aside'));
          if (closeBtn) closeBtn.click();
        }
      });
      await sleep(1000); // Wait for sidebar close transition
    } else {
      await page.goto('https://www.seekonapparelglobal.com/admin/add-product');
    }
    
    await sleep(1500); // Let page load

    // ==========================================
    // SECTION 4: Product Name & AI Description
    // ==========================================
    currentSectionIndex = 4;
    console.log('✍️ [SECTION 4] Typing product details & AI description...');
    await captureFrame(page);

    // Click and type product name
    await typeInElement(page, 'input[name="name"]', 'Seekon Aura Heavyweight Hoodie');
    await sleep(500);

    // Select Auto-Generate description button
    const autoGenBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Auto-Generate'));
      if (btn) {
        btn.id = 'auto-generate-btn';
        return '#auto-generate-btn';
      }
      return null;
    });

    if (autoGenBtn) {
      await clickElement(page, autoGenBtn);
      
      // Simulate 1.5 seconds loading state by capturing frames
      for (let i = 0; i < 30; i++) {
        await captureFrame(page);
        await sleep(50);
      }

      // Populate description content programmatically
      await page.evaluate(() => {
        const txt = document.querySelector('textarea[name="description"]');
        if (txt) {
          txt.value = "Premium 450gsm organic cotton hoodie with minimalist embroidery, designed for maximum comfort and style.";
          txt.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await captureFrame(page);
    }
    await sleep(1000);

    // ==========================================
    // SECTION 5: Forms & Chip Selectors
    // ==========================================
    currentSectionIndex = 5;
    console.log('🗂️ [SECTION 5] Setting categories, price, stock, sizes & colors...');
    
    // Scroll down to Category / Brand selects
    await smoothScroll(page, 200, 15);
    await sleep(500);

    // Select category APPAREL
    await clickElement(page, 'select[name="category"]');
    await page.select('select[name="category"]', 'APPAREL');
    await page.evaluate(() => {
      document.querySelector('select[name="category"]').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(600);
    await captureFrame(page);

    // Select brand SEEKON
    await clickElement(page, 'select[name="brand"]');
    await page.select('select[name="brand"]', 'SEEKON');
    await page.evaluate(() => {
      document.querySelector('select[name="brand"]').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(600);
    await captureFrame(page);

    // Select subcategory HOODIES
    await clickElement(page, 'select[name="subCategory"]');
    await page.select('select[name="subCategory"]', 'HOODIES');
    await page.evaluate(() => {
      document.querySelector('select[name="subCategory"]').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(600);
    await captureFrame(page);

    // Scroll to pricing and quantities
    await smoothScroll(page, 250, 15);
    await sleep(500);

    // Input Price, Original Price, Stock
    await typeInElement(page, 'input[name="price"]', '1200');
    await sleep(300);
    await typeInElement(page, 'input[name="originalPrice"]', '1500');
    await sleep(300);
    await typeInElement(page, 'input[name="stock"]', '50');
    await sleep(500);

    // Scroll down to size/color chips
    await smoothScroll(page, 260, 15);
    await sleep(500);

    // Find M, L, XL size chips and click them
    const sizeSelectors = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(el => ['M', 'L', 'XL'].includes(el.textContent.trim()));
      btns.forEach(btn => btn.id = `size-chip-${btn.textContent.trim()}`);
      return btns.map(btn => `#size-chip-${btn.textContent.trim()}`);
    });

    for (let selector of sizeSelectors) {
      await clickElement(page, selector);
      await sleep(300);
    }

    // Find Black, Grey color chips and click them
    const colorSelectors = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(el => ['Black', 'Grey'].includes(el.textContent.trim()));
      btns.forEach(btn => btn.id = `color-chip-${btn.textContent.trim()}`);
      return btns.map(btn => `#color-chip-${btn.textContent.trim()}`);
    });

    for (let selector of colorSelectors) {
      await clickElement(page, selector);
      await sleep(300);
    }
    await sleep(1000);

    // ==========================================
    // SECTION 6: Device Image Picker
    // ==========================================
    currentSectionIndex = 6;
    console.log('🖼️ [SECTION 6] Uploading product image...');
    
    // Scroll back up to the Image section
    await smoothScroll(page, -700, 18);
    await sleep(500);

    // Click "Add Single Image" button
    const singleImageBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Add Single Image'));
      if (btn) {
        btn.id = 'add-single-image-btn';
        return '#add-single-image-btn';
      }
      return null;
    });

    if (singleImageBtn) {
      await clickElement(page, singleImageBtn);
      await sleep(500);
    }

    // 1. Injected Mock File Picker Drawer overlay
    console.log('📁 Displaying Mock File Picker Overlay...');
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'mock-file-picker-styles';
      style.innerHTML = `
        #mock-file-picker-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          z-index: 20000000;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        #mock-file-picker-drawer {
          width: 100%;
          max-width: 480px;
          background: #1c1c1e;
          border-radius: 20px 20px 0 0;
          padding: 20px;
          box-sizing: border-box;
          transform: translateY(100%);
          transition: transform 0.3s ease;
        }
        .picker-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #fff;
          font-weight: bold;
          font-size: 16px;
          margin-bottom: 20px;
          border-bottom: 1px solid #2c2c2e;
          padding-bottom: 12px;
        }
        .picker-grid {
          display: grid;
          grid-template-cols: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 20px;
        }
        .picker-item {
          background: #2c2c2e;
          border-radius: 12px;
          padding: 8px;
          text-align: center;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          transition: background 0.2s;
          border: 2px solid transparent;
        }
        .picker-item.selected {
          border-color: #00A676;
        }
        .picker-thumbnail {
          width: 80px;
          height: 80px;
          object-fit: cover;
          border-radius: 8px;
          margin-bottom: 8px;
        }
        .picker-label {
          color: #e5e5ea;
          font-size: 11px;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow: hidden;
          width: 80px;
        }
      `;
      document.head.appendChild(style);

      const overlay = document.createElement('div');
      overlay.id = 'mock-file-picker-overlay';
      
      const drawer = document.createElement('div');
      drawer.id = 'mock-file-picker-drawer';
      
      drawer.innerHTML = `
        <div class="picker-header">
          <span>Files</span>
          <span style="font-size: 14px; color: #8e8e93;">Cancel</span>
        </div>
        <div style="color: #8e8e93; font-size: 11px; margin-bottom: 12px; font-weight: 600; text-transform: uppercase;">Recents</div>
        <div class="picker-grid">
          <div class="picker-item" id="mock-picker-item-hoodie">
            <img class="picker-thumbnail" src="https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=150" onerror="this.src='https://placehold.co/150x150?text=Hoodie'">
            <div class="picker-label">streetwear_hoodie.jpg</div>
          </div>
          <div class="picker-item" style="opacity: 0.4;">
            <div class="picker-thumbnail" style="background: #3a3a3c; display: flex; align-items: center; justify-content: center; color: #8e8e93; font-size: 24px;">📁</div>
            <div class="picker-label">Downloads</div>
          </div>
          <div class="picker-item" style="opacity: 0.4;">
            <div class="picker-thumbnail" style="background: #3a3a3c; display: flex; align-items: center; justify-content: center; color: #8e8e93; font-size: 24px;">📁</div>
            <div class="picker-label">Documents</div>
          </div>
        </div>
      `;
      
      overlay.appendChild(drawer);
      document.body.appendChild(overlay);

      setTimeout(() => {
        overlay.style.opacity = '1';
        drawer.style.transform = 'translateY(0)';
      }, 50);
    });

    // Capture overlay load frame
    await sleep(800);
    await captureFrame(page);

    // Select the hoodie item
    await clickElement(page, '#mock-picker-item-hoodie');
    
    // Add selected class to selection UI
    await page.evaluate(() => {
      const item = document.getElementById('mock-picker-item-hoodie');
      if (item) item.classList.add('selected');
    });
    await captureFrame(page);
    await sleep(800);

    // Slide down drawer and fade out mock file picker
    await page.evaluate(() => {
      const overlay = document.getElementById('mock-file-picker-overlay');
      const drawer = document.getElementById('mock-file-picker-drawer');
      if (overlay && drawer) {
        drawer.style.transform = 'translateY(100%)';
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          const style = document.getElementById('mock-file-picker-styles');
          if (style) style.remove();
        }, 300);
      }
    });
    await sleep(350);

    // Trigger actual image upload to hidden input
    const mockImagePath = 'C:/Users/Nextgen/.gemini/antigravity-cli/brain/63833d3a-971e-46f7-a658-c887f77ac931/streetwear_hoodie_1783457159641.jpg';
    const singleInput = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('input[type="file"]')).find(el => !el.multiple);
    });
    
    if (singleInput) {
      await singleInput.uploadFile(mockImagePath);
    }
    
    // Wait for preview processing (render multiple frames)
    for (let i = 0; i < 40; i++) {
      await captureFrame(page);
      await sleep(50);
    }
    await sleep(1000);

    // ==========================================
    // SECTION 7: Form Submission
    // ==========================================
    currentSectionIndex = 7;
    console.log('🚀 [SECTION 7] Form Submission...');
    
    // Scroll to the submit button
    await smoothScroll(page, 750, 18);
    await sleep(500);

    // Click submit
    await clickElement(page, 'button[type="submit"]');

    // Wait for submission response and success popup toast
    for (let i = 0; i < 60; i++) {
      await captureFrame(page);
      await sleep(50);
    }
    await sleep(1500);

    // ==========================================
    // SECTION 8: Storefront Shop View
    // ==========================================
    currentSectionIndex = 8;
    console.log('🛒 [SECTION 8] Storefront Shop View verification...');
    
    // Open admin side menu drawer
    const headerMenuBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.className.includes('lg:hidden') && el.querySelector('svg'));
      if (btn) {
        btn.id = 'admin-menu-toggle-btn-final';
        return '#admin-menu-toggle-btn-final';
      }
      return null;
    });

    if (headerMenuBtn) {
      await clickElement(page, headerMenuBtn);
      await sleep(1000); // Let drawer slide open
    }

    // Click "Shop View" external redirect link
    const shopViewLink = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim().includes('Shop View'));
      if (btn) {
        btn.id = 'admin-sidebar-shop-view-link';
        return '#admin-sidebar-shop-view-link';
      }
      return null;
    });

    if (shopViewLink) {
      await clickElement(page, shopViewLink);
    } else {
      await page.goto('https://www.seekonapparelglobal.com/?admin=true');
    }
    
    await sleep(4000); // Let storefront load completely

    // Scroll down storefront to display newly added product
    await smoothScroll(page, 750, 22);
    await sleep(1000);

    // Capture final look frames
    for (let i = 0; i < 60; i++) {
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
