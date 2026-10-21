import mongoose from 'mongoose';
import { normalizePhone } from '../utils/phoneFormatter.js';
import Product from '../models/Product.js';

// Common Kenyan locations & estates to auto-extract from messages
const NAIROBI_ESTATES = [
  'kilimani', 'westlands', 'kahawa sukari', 'kahawa wendani', 'runda', 'ngong rd',
  'ngong road', 'cbd', 'kileleshwa', 'lavington', 'parklands', 'south b', 'south c',
  'langata', 'roysambu', 'kasarani', 'karen', 'juja', 'thika', 'ruiru', 'syokimau',
  'kitengela', 'kiambu', 'embakasi', 'donholm', 'buruburu', 'pangani', 'muthaiga',
  'gigiri', 'umoja', 'fedha', 'nairobi west', 'nairobi', 'mombasa', 'nakuru', 'eldoret', 'kisumu'
];

/**
 * Checks whether an incoming message is an order instruction or interception.
 */
export const isOrderMessage = (text) => {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // 1. Explicit command keywords
  if (
    lower.startsWith('order:') ||
    lower.startsWith('/order') ||
    lower.startsWith('order for') ||
    lower.startsWith('pod ') ||
    lower.startsWith('pod:') ||
    (lower.includes('customer:') && (lower.includes('item') || lower.includes('total') || lower.includes('kes') || lower.includes('size'))) ||
    (/\b(order|pos|pod)\b/i.test(lower) && /\b(phone|customer|tel)\b/i.test(lower))
  ) {
    return true;
  }

  // 2. Interception pattern: Phone number + (size indicator OR apparel keyword)
  const hasPhone = /(?:\+?254|0)?([17]\d{8})\b/.test(clean);
  const hasSize = /\b(?:size\s*[:=-]?\s*)?(XXS|XS|S|M|L|XL|2XL|XXL|3XL|\b(?:2[89]|3[0-8]|4[0-4])\b)\b/i.test(clean);
  const hasApparelKeyword = /\b(tee|t-shirt|shirt|fleece|hoodie|shorts|cargo|pants|jacket|vest|trackpants|cap|beanie|sweater|sweatpants|sneakers|suit|drop)\b/i.test(clean);

  return hasPhone && (hasSize || hasApparelKeyword);
};

/**
 * Searches the MongoDB Product catalog by tokenized keyword density and SKU/Barcode.
 */
export const matchProductFromQuery = async (query) => {
  if (!query || typeof query !== 'string') return null;
  const cleanQ = query.trim().toLowerCase();
  if (!cleanQ || mongoose.connection?.readyState !== 1) return null;

  try {
    // 1. Try exact or direct substring match
    const exact = await Product.findOne({
      status: { $ne: 'inactive' },
      $or: [
        { name: { $regex: cleanQ, $options: 'i' } },
        { sku: { $regex: `^${cleanQ}$`, $options: 'i' } },
        { barcode: cleanQ }
      ]
    }).select('name price stock image images sizes colors category sku barcode').lean();

    if (exact) return exact;

    // 2. Tokenize and search by relevant words
    const tokens = cleanQ
      .split(/\s+/)
      .filter(t => t.length > 2 && !['seekon', 'apparel', 'size', 'kes', 'location', 'phone', 'order', 'pod', 'with', 'for'].includes(t));

    if (tokens.length === 0) return null;

    const candidates = await Product.find({
      status: { $ne: 'inactive' },
      $or: tokens.map(t => ({ name: { $regex: t, $options: 'i' } }))
    }).select('name price stock image images sizes colors category sku barcode').limit(15).lean();

    if (!candidates.length) return null;

    let best = null;
    let maxScore = 0;

    for (const prod of candidates) {
      const nameLower = prod.name.toLowerCase();
      let score = 0;
      if (nameLower.includes(cleanQ)) score += 10;
      for (const t of tokens) {
        if (nameLower.includes(t)) score += 3;
      }
      if (score > maxScore) {
        maxScore = score;
        best = prod;
      }
    }

    return best;
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
  for (const line of lines) {
    const customerMatch = line.match(/(?:customer|client|buyer|name)\s*[:=-]?\s*([^\n,]+)/i);
    if (customerMatch) {
      const rawName = customerMatch[1].replace(phoneRegex, '').replace(/[-–]/g, '').trim();
      if (rawName) result.customerName = rawName;
      break;
    }
  }

  // 3. Extract Quantity (Ensure phone number is not mistaken for quantity)
  const textWithoutPhone = phoneMatch ? text.replace(phoneMatch[0], ' ') : text;
  const qtyRegex = /\b(\d{1,2})\s*(?:x|pcs|pieces)\b/i;
  const qtyMatch = textWithoutPhone.match(qtyRegex) || textWithoutPhone.match(/^(?:[-*•]\s*)?(\d{1,2})\s*(?:x\s*)/i);
  if (qtyMatch) {
    result.quantity = Math.max(1, parseInt(qtyMatch[1], 10) || 1);
  } else {
    result.quantity = 1;
  }

  // 4. Extract Size
  const sizeRegex = /\b(?:size\s*[:=-]?\s*)?(XXS|XS|S|M|L|XL|2XL|XXL|3XL|\b(?:2[89]|3[0-8]|4[0-4])\b)\b/i;
  const sizeMatch = text.match(sizeRegex);
  if (sizeMatch) {
    result.size = sizeMatch[1].toUpperCase();
  }

  // 5. Extract Delivery Location
  const locExplicitMatch = text.match(/(?:location|loc|deliver to|destination|estate)\s*[:=-]?\s*([^\n,;]+)/i);
  if (locExplicitMatch) {
    result.location = locExplicitMatch[1].trim();
  } else {
    // Scan for known Nairobi estates
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
  if (result.location) cleanQuery = cleanQuery.replace(new RegExp(result.location, 'i'), ' ');
  cleanQuery = cleanQuery.replace(/^(?:order|pod|customer|client|product|item|location|deliver to)[:,\s-]*/gi, ' ');
  cleanQuery = cleanQuery.replace(/\b(?:order|pod|size|location|loc|customer|name|client|phone|tel|kes|ksh)[:,\s-]*/gi, ' ');
  cleanQuery = cleanQuery.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();

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
