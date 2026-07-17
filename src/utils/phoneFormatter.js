/**
 * Normalizes any Kenyan phone number format to a clean international format without leading '+' or spaces.
 * Supports:
 * - 7XXXXXXXX (9 digits) -> 2547XXXXXXXX
 * - 07XXXXXXXX (10 digits) -> 2547XXXXXXXX
 * - 2547XXXXXXXX (12 digits) -> 2547XXXXXXXX
 * - +2547XXXXXXXX (13 digits with +) -> 2547XXXXXXXX
 * - 25407XXXXXXXX (13 digits) -> 2547XXXXXXXX
 * - +254 07XXXXXXXX (with spaces/plus) -> 2547XXXXXXXX
 * - Also supports prefix 1 (e.g. 1XXXXXXXX, 01XXXXXXXX, 25401XXXXXXXX, etc.)
 * 
 * @param {string|number} phone - The phone number to normalize.
 * @returns {string} The normalized phone number digits (e.g. "254712345678").
 */
export const normalizePhone = (phone) => {
  if (!phone) return '';
  
  // Remove all non-digits
  let clean = String(phone).replace(/\D/g, '');
  
  // Handle "254 07..." or "254 01..." format (length 13, starts with 2540)
  if (clean.startsWith('2540') && clean.length >= 12) {
    clean = '254' + clean.slice(4);
  }
  
  // Handle local format starting with 0 (e.g., 07... or 01...)
  if (clean.startsWith('0') && (clean.length === 10 || clean.length === 11)) {
    clean = '254' + clean.slice(1);
  }
  
  // Handle 9-digit format (e.g., 7XXXXXXXX or 1XXXXXXXX)
  if (!clean.startsWith('254') && clean.length === 9) {
    clean = '254' + clean;
  }
  
  return clean;
};
