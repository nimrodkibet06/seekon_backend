import mongoose from 'mongoose';
import { normalizePhone } from '../utils/phoneFormatter.js';
import Product from '../models/Product.js';

// Common Kenyan locations & estates to auto-extract from messages
const NAIROBI_ESTATES = [
  'kilimani', 'westlands', 'kahawa sukari', 'kahawa wendani', 'runda', 'ngong rd',
  'ngong road', 'cbd', 'kileleshwa', 'lavington', 'parklands', 'south b', 'south c',
  'langata', 'roysambu', 'kasarani', 'karen', 'juja', 'thika', 'ruiru', 'syokimau',
  'kitengela', 'kiambu', 'embakasi', 'donholm', 'buruburu', 'pangani', 'muthaiga',
  'gigiri', 'umoja', 'fedha', 'nairobi west', 'nairobi', 'mombasa', 'nakuru', 'eldoret',
  'kisumu', 'ngong', 'rongai', 'ongata rongai', 'machakos', 'naivasha'
];

/**
 * Levenshtein distance for typo-tolerant product matching (e.g. 'reebot' -> 'reboot')
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1).toLowerCase() === a.charAt(j - 1).toLowerCase()) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Checks whether an incoming message is an order instruction or interception.
 */
export const isOrderMessage = (text) => {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // 1. Explicit slash commands or prefixes
  if (
    lower.startsWith('order:') ||
    lower.startsWith('/order') ||
    lower.startsWith('order for') ||
    lower.startsWith('pod ') ||
    lower.startsWith('pod:')
  ) {
    return true;
  }

  // 2. Mobile Phone Number check (Kenyan formats: 07..., 01..., +254...)
  const phoneRegex = /(?:\+?254|0)?([17]\d{8})\b/;
  const hasPhone = phoneRegex.test(clean);

  // 3. Natural order / transaction verbs (including typos like 'odered')
  const hasOrderIntent = /\b(?:order|ordered|odered|orders|ordering|pod|pos|wants|want|buying|bought|buy|dispatch|deliver|delivered|delivery|send|sent|take|taken|drop)\b/i.test(clean);

  // 4. Customer / Person indicators
  const hasCustomerIndicator = /\b(?:customer|client|buyer|name|recipient)\b/i.test(clean);

  // 5. Footwear, apparel, and major brand keywords
  const hasProductKeywords = /\b(?:adidas|nike|jordan|puma|reebok|reebot|converse|vans|new balance|timberland|yeezy|asics|clarks|crocs|fleece|hoodie|tee|t-shirt|shirt|shorts|cargo|pants|jacket|vest|trackpants|cap|beanie|sweater|sweatpants|sneakers|shoes|kicks|boots|slides|reboot|mfx|dunk|samba|gazelle|stan smith|air force|af1|suit|drop|apparel)\b/i.test(clean);

  // 6. Size indicator (standard clothing sizes or shoe sizes 28-46)
  const hasSize = /\b(?:size\s*[:=-]?\s*)?(XXS|XS|S|M|L|XL|2XL|XXL|3XL|\b(?:2[89]|3[0-9]|4[0-6])\b)\b/i.test(clean);

  // 7. Destination / Estate keyword
  const hasLocation = NAIROBI_ESTATES.some(est => new RegExp(`\\b${est}\\b`, 'i').test(clean));

  // If a phone number is provided along with ANY context (intent, customer tag, product name, size, or destination):
  if (hasPhone && (hasOrderIntent || hasCustomerIndicator || hasProductKeywords || hasSize || hasLocation)) {
    return true;
  }

  // Also match cases where staff write "Customer: John, Tech Fleece, total KES 4500" without phone yet
  if (hasCustomerIndicator && (hasOrderIntent || hasProductKeywords) && (hasSize || hasLocation || /\bkes\b|\bksh\b/i.test(clean))) {
    return true;
  }

  return false;
};

/**
 * Searches the MongoDB Product catalog by tokenized keyword density and SKU/Barcode with typo tolerance.
 */
export const matchProductFromQuery = async (query) => {
  if (!query || typeof query !== 'string') return null;
  const cleanQ = query.trim().toLowerCase();
  if (!cleanQ || mongoose.connection?.readyState !== 1) return null;

  try {
    // 1. Try exact or direct substring match across name, brand, sku, barcode
    const exact = await Product.findOne({
      status: { $ne: 'inactive' },
      $or: [
        { name: { $regex: cleanQ, $options: 'i' } },
        { brand: { $regex: cleanQ, $options: 'i' } },
        { sku: { $regex: `^${cleanQ}$`, $options: 'i' } },
        { barcode: cleanQ }
      ]
    }).select('name price stock image images sizes colors category brand sku barcode').lean();

    if (exact) return exact;

    // 2. Tokenize and search by relevant words
    const tokens = cleanQ
      .split(/\s+/)
      .filter(t => t.length > 1 && !['seekon', 'apparel', 'size', 'kes', 'ksh', 'location', 'phone', 'order', 'pod', 'with', 'for', 'the'].includes(t));

    if (tokens.length === 0) return null;

    // Search across BOTH name AND brand in MongoDB
    const candidateConditions = tokens.flatMap(t => [
      { name: { $regex: t, $options: 'i' } },
      { brand: { $regex: t, $options: 'i' } }
    ]);

    let candidates = await Product.find({
      status: { $ne: 'inactive' },
      $or: candidateConditions
    }).select('name price stock image images sizes colors category brand sku barcode').limit(25).lean();

    // If no candidate was found by direct token regex, fetch active catalog sample for fuzzy matching
    if (!candidates.length) {
      candidates = await Product.find({ status: { $ne: 'inactive' } })
        .select('name price stock image images sizes colors category brand sku barcode')
        .limit(50)
        .lean();
    }

    if (!candidates.length) return null;

    let best = null;
    let maxScore = 0;

    for (const prod of candidates) {
      const nameLower = (prod.name || '').toLowerCase();
      const brandLower = (prod.brand || '').toLowerCase();
      const fullText = `${brandLower} ${nameLower}`;
      const prodWords = fullText.split(/\s+/).filter(Boolean);

      let score = 0;
      if (nameLower.includes(cleanQ)) score += 15;
      if (fullText.includes(cleanQ)) score += 12;

      for (const t of tokens) {
        if (nameLower.includes(t)) {
          score += 6;
        } else if (brandLower.includes(t)) {
          score += 5;
        } else {
          // Fuzzy match against individual words in product name/brand
          for (const pw of prodWords) {
            if (pw.length >= 4 && t.length >= 4) {
              const dist = levenshteinDistance(t, pw);
              if (dist <= 2) {
                score += 4;
                break;
              }
            }
          }
        }
      }

      if (score > maxScore) {
        maxScore = score;
        best = prod;
      }
    }

    return maxScore >= 4 ? best : null;
  } catch (err) {
    console.error('Error matching product from query:', err.message);
    return null;
  }
};

/**
 * Parses freeform manual order messages into structured Order / PendingOrder payload.
 */
export const parseWhatsAppOrderText = async (text) => {
  const result = {
    customerName: 'WhatsApp Customer',
    customerPhone: '',
    items: [],
    totalAmount: 0,
    paymentMethod: 'POD',
    payments: { cash: 0, mpesa: 0 },
    notes: '',
    location: '',
    size: 'Standard',
    quantity: 1,
    matchedProduct: null
  };

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Extract Phone Number
  const phoneRegex = /(?:\+?254|0)?([17]\d{8})\b/;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) {
    result.customerPhone = normalizePhone(phoneMatch[0]);
  }

  // 2. Extract Customer Name
  // Priority A: "Customer/Client/Buyer/Recipient/Name [Name]" up to the first verb, preposition, phone indicator, or punctuation
  const customerPrefixMatch = text.match(
    /(?:customer|client|buyer|recipient|name)\s*[:=-]?\s*([a-zA-Z\s'.]+?)(?=\s+(?:odered|ordered|order|orders|ordering|buying|bought|wants|want|needs|need|taking|takes|take|deliver|delivering|delivered|delivery|taken|send|sending|sent|phone|tel|number|no|contact|at|in|to|the|size|item|product|kes|ksh|\d)|[,:\n\-]|$)/i
  );

  if (customerPrefixMatch && customerPrefixMatch[1].trim()) {
    const candidate = customerPrefixMatch[1].replace(/[-–]/g, '').trim();
    if (candidate && candidate.length <= 40 && !['phone', 'tel', 'order', 'pod', 'to', 'the', 'item'].includes(candidate.toLowerCase())) {
      result.customerName = candidate;
    }
  } else {
    // Priority B: "[Name] (ordered|odered|wants|bought) ..."
    const nameBeforeOrderMatch = text.match(
      /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:odered|ordered|orders|ordering|wants|bought|taking)\b/i
    );
    if (nameBeforeOrderMatch && nameBeforeOrderMatch[1].trim()) {
      result.customerName = nameBeforeOrderMatch[1].trim();
    }
  }

  // 3. Extract Quantity (Ensure phone number is not mistaken for quantity)
  const textWithoutPhone = phoneMatch ? text.replace(phoneMatch[0], ' ') : text;
  const qtyRegex = /\b(\d{1,2})\s*(?:x|pcs|pieces|pairs)\b/i;
  const qtyMatch = textWithoutPhone.match(qtyRegex) || textWithoutPhone.match(/^(?:[-*•]\s*)?(\d{1,2})\s*(?:x\s*)/i);
  if (qtyMatch) {
    result.quantity = Math.max(1, parseInt(qtyMatch[1], 10) || 1);
  } else {
    result.quantity = 1;
  }

  // 4. Extract Size
  const sizeRegex = /\b(?:size\s*[:=-]?\s*)?(XXS|XS|S|M|L|XL|2XL|XXL|3XL|\b(?:2[89]|3[0-9]|4[0-6])\b)\b/i;
  const sizeMatch = text.match(sizeRegex);
  if (sizeMatch) {
    result.size = sizeMatch[1].toUpperCase();
  }

  // 5. Extract Delivery Location
  const locExplicitMatch = text.match(
    /(?:location|loc|deliver to|delivery to|destination|estate|to be taken to|taken to|take to|send to|bring to)\s*[:=-]?\s*([^\n,;]+)/i
  );
  if (locExplicitMatch) {
    const rawLoc = locExplicitMatch[1].replace(phoneRegex, '').replace(/\b(?:phone|number|tel)\b.*/i, '').trim();
    if (rawLoc) {
      result.location = rawLoc.charAt(0).toUpperCase() + rawLoc.slice(1);
    }
  }

  if (!result.location) {
    // Scan for known Nairobi & Kenyan estates
    const textLower = text.toLowerCase();
    for (const est of NAIROBI_ESTATES) {
      if (new RegExp(`\\b${est}\\b`, 'i').test(textLower)) {
        result.location = est.charAt(0).toUpperCase() + est.slice(1);
        break;
      }
    }
  }

  // 6. Extract Payment Details if specified
  if (/cash/i.test(text) && /mpesa|m-pesa/i.test(text)) {
    result.paymentMethod = 'Split';
    const cashMatch = text.match(/cash\s*[:=-]?\s*(?:kes|ksh)?\s*(\d+)/i);
    const mpesaMatch = text.match(/m-?pesa\s*[:=-]?\s*(?:kes|ksh)?\s*(\d+)/i);
    if (cashMatch) result.payments.cash = Number(cashMatch[1]);
    if (mpesaMatch) result.payments.mpesa = Number(mpesaMatch[1]);
  } else if (/cash/i.test(text)) {
    result.paymentMethod = 'Cash';
  } else if (/mpesa|m-pesa/i.test(text)) {
    result.paymentMethod = 'M-Pesa';
  }

  // 7. Extract Total Amount if provided
  const totalMatch = text.match(/(?:total|amount|sum)\s*[:=-]?\s*(?:kes|ksh)?\s*([\d,]+)/i);
  if (totalMatch) {
    result.totalAmount = Number(totalMatch[1].replace(/,/g, ''));
  }

  // 8. Match Product in Inventory
  // Clean text to extract pure product query
  let cleanQuery = text;
  if (phoneMatch) cleanQuery = cleanQuery.replace(phoneMatch[0], ' ');
  if (sizeMatch) cleanQuery = cleanQuery.replace(sizeMatch[0], ' ');
  if (qtyMatch) cleanQuery = cleanQuery.replace(qtyMatch[0], ' ');
  if (result.location) cleanQuery = cleanQuery.replace(new RegExp(`\\b${result.location}\\b`, 'gi'), ' ');
  if (result.customerName && result.customerName !== 'WhatsApp Customer') {
    cleanQuery = cleanQuery.replace(new RegExp(`\\b${result.customerName}\\b`, 'gi'), ' ');
  }

  // Strip conversational noise words & phrases
  cleanQuery = cleanQuery
    .replace(/\b(?:customer|client|buyer|name|recipient)[:,\s-]*/gi, ' ')
    .replace(/\b(?:odered|ordered|orders|ordering|order|wants|want|buying|bought|taking|takes|take|dispatch|send|sent)\b/gi, ' ')
    .replace(/\b(?:to be taken to|taken to|take to|to be delivered to|deliver to|delivered to|delivery to|send to|bring to)\b/gi, ' ')
    .replace(/\b(?:phone number|phone no|phone|tel|number|no|mobile|contact)[:,\s-]*/gi, ' ')
    .replace(/\b(?:to be|the|a|an|for|at|in|with|of|on|is|size|kes|ksh|total|amount|pod|pos)\b/gi, ' ')
    .replace(/[,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const matched = await matchProductFromQuery(cleanQuery);
  if (matched) {
    result.matchedProduct = matched;
    const unitPrice = matched.price || 0;
    const lineTotal = unitPrice * result.quantity;

    if (!result.totalAmount) {
      result.totalAmount = lineTotal;
    }

    result.items.push({
      product: matched._id,
      productName: matched.name,
      name: matched.name,
      quantity: result.quantity,
      price: unitPrice,
      size: result.size,
      color: 'Standard',
      image: matched.image || matched.images?.[0] || ''
    });
  }

  return result;
};
