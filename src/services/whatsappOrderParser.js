import mongoose from 'mongoose';
import { normalizePhone } from '../utils/phoneFormatter.js';
import Product from '../models/Product.js';

/**
 * Checks whether an incoming group message is intended as a manual order instruction.
 */
export const isOrderMessage = (text) => {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  return (
    lower.startsWith('order:') ||
    lower.startsWith('/order') ||
    lower.startsWith('order for') ||
    (lower.includes('customer:') && (lower.includes('item') || lower.includes('total') || lower.includes('kes'))) ||
    (/\b(order|pos)\b/i.test(lower) && /\b(phone|customer|tel)\b/i.test(lower))
  );
};

/**
 * Parses freeform manual order messages into structured PendingOrder payload.
 */
export const parseWhatsAppOrderText = async (text) => {
  const result = {
    customerName: 'WhatsApp Customer',
    customerPhone: '',
    items: [],
    totalAmount: 0,
    paymentMethod: 'Pending',
    payments: { cash: 0, mpesa: 0 },
    notes: ''
  };

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Extract Phone Number
  const phoneRegex = /(?:\+?254|0)?([17]\d{8})/g;
  const phoneMatches = text.match(phoneRegex);
  if (phoneMatches && phoneMatches.length > 0) {
    result.customerPhone = normalizePhone(phoneMatches[0]);
  }

  // 2. Extract Customer Name
  for (const line of lines) {
    const customerMatch = line.match(/(?:customer|client|buyer|name)\s*:\s*([^\n,]+)/i);
    if (customerMatch) {
      const rawName = customerMatch[1].replace(phoneRegex, '').replace(/[-–]/g, '').trim();
      if (rawName) result.customerName = rawName;
      break;
    }
  }

  // 3. Extract Payment Method & Split Details
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
  } else if (/card/i.test(text)) {
    result.paymentMethod = 'Card';
  }

  // 4. Extract Total Amount
  const totalMatch = text.match(/(?:total|amount|sum)\s*[:=-]?\s*(?:kes|ksh)?\s*([\d,]+)/i);
  if (totalMatch) {
    result.totalAmount = Number(totalMatch[1].replace(/,/g, ''));
  }

  // 5. Extract Items
  const sizeRegex = /\b(XXS|XS|S|M|L|XL|2XL|XXL|3XL)\b/i;
  const colorList = ['black', 'white', 'grey', 'gray', 'red', 'blue', 'navy', 'green', 'brown', 'beige'];

  for (const line of lines) {
    // Skip header lines
    if (/^(order:|customer:|phone:|total:|payment:|notes:)/i.test(line)) continue;

    // Detect item line: e.g. "- 2x Signature Hoodie @ 3500", "1 Black Tee size M - 1500"
    const qtyMatch = line.match(/^(?:[-*•]\s*)?(\d+)\s*(?:x\s*)?(.*)/i);
    if (qtyMatch) {
      const quantity = parseInt(qtyMatch[1], 10) || 1;
      let rawRest = qtyMatch[2].trim();

      // Extract price from line if present: e.g. "@ 3500", "- 3500", "KES 3,500"
      let itemPrice = 0;
      const priceMatch = rawRest.match(/(?:@|kes|ksh|[-–=])?\s*([\d,]{3,})/i);
      if (priceMatch) {
        itemPrice = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        rawRest = rawRest.replace(priceMatch[0], '').trim();
      }

      // Extract Size
      let itemSize = '';
      const sizeMatch = rawRest.match(sizeRegex);
      if (sizeMatch) {
        itemSize = sizeMatch[1].toUpperCase();
        rawRest = rawRest.replace(sizeMatch[0], '').trim();
      }

      // Extract Color
      let itemColor = 'Standard';
      for (const col of colorList) {
        if (new RegExp(`\\b${col}\\b`, 'i').test(rawRest)) {
          itemColor = col.charAt(0).toUpperCase() + col.slice(1);
          rawRest = rawRest.replace(new RegExp(`\\b${col}\\b`, 'i'), '').trim();
          break;
        }
      }

      // Clean item name
      const itemName = rawRest.replace(/^[-–@:]+|[-–@:]+$/g, '').trim() || 'Custom Item';

      // Attempt to fuzzy match product in DB to link ObjectId and price
      let linkedProductId = null;
      try {
        if (mongoose.connection?.readyState === 1) {
          const found = await Product.findOne({
            name: { $regex: new RegExp(itemName.slice(0, 15), 'i') }
          }).select('_id name price');

          if (found) {
            linkedProductId = found._id;
            if (!itemPrice) itemPrice = found.price;
          }
        }
      } catch (e) {
        // Continue with unlinked item
      }

      result.items.push({
        product: linkedProductId,
        name: itemName,
        quantity,
        price: itemPrice || 0,
        size: itemSize,
        color: itemColor
      });
    }
  }

  // If totalAmount was not explicitly given, calculate sum of items
  const itemsSum = result.items.reduce((acc, it) => acc + (it.price * it.quantity), 0);
  if (!result.totalAmount && itemsSum > 0) {
    result.totalAmount = itemsSum;
  }

  // Set split payment fallbacks if needed
  if (result.paymentMethod === 'Cash' && !result.payments.cash) {
    result.payments.cash = result.totalAmount;
  } else if (result.paymentMethod === 'M-Pesa' && !result.payments.mpesa) {
    result.payments.mpesa = result.totalAmount;
  }

  return result;
};
