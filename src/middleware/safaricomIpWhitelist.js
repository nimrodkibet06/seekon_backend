// Official Safaricom Daraja IP ranges (Subject to updates by Safaricom)
export const safaricomIPs = [
  '196.201.214.200',
  '196.201.214.206', 
  '196.201.213.114',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.138',
  '196.201.212.129',
  '196.201.212.136',
  '196.201.212.74',
  '196.201.212.69'
];

// Official Safaricom Daraja CIDR subnets
export const safaricomSubnets = [
  '196.201.214.0/24',
  '196.201.213.0/24',
  '196.201.212.0/24'
];

/**
 * Normalizes an IP address by:
 * - Trimming whitespace
 * - Stripping surrounding quotes (RFC 7239 / HTTP quoting)
 * - Stripping IPv6 brackets and optional port ([::1]:3000 -> ::1, [::ffff:1.2.3.4]:80 -> 1.2.3.4)
 * - Stripping IPv4 port (192.168.1.1:8080 -> 192.168.1.1)
 * - Stripping IPv6-mapped IPv4 prefix case-insensitively (::ffff:192.168.1.1 or ::FFFF:192.168.1.1 -> 192.168.1.1)
 * - Stripping IPv6 zone index (fe80::1%eth0 -> fe80::1)
 * @param {string} ip
 * @returns {string}
 */
export const normalizeIp = (ip) => {
  if (!ip || typeof ip !== 'string') return '';
  let clean = ip.trim();

  // Strip surrounding quotes if present (e.g. from RFC 7239 or quoted header values)
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    clean = clean.slice(1, -1).trim();
  }

  // Strip IPv6 brackets and optional port (handles standard IPv6 and IPv4-mapped IPv6 like [::ffff:1.2.3.4]:443)
  const bracketMatch = clean.match(/^\[([a-fA-F0-9:.]+)\](?::\d+)?$/);
  if (bracketMatch) {
    clean = bracketMatch[1];
  } else {
    // Strip IPv4 port (only if standard IPv4 format with colon followed by port)
    const ipv4PortMatch = clean.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
    if (ipv4PortMatch) {
      clean = ipv4PortMatch[1];
    }
  }

  // Strip IPv4-mapped IPv6 prefix case-insensitively: ::ffff:192.168.1.1 or ::FFFF:192.168.1.1
  if (clean.toLowerCase().startsWith('::ffff:')) {
    clean = clean.slice(7);
    const ipv4PortMatch2 = clean.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$/);
    if (ipv4PortMatch2) {
      clean = ipv4PortMatch2[1];
    }
  }

  // Strip IPv6 zone index if present (e.g. fe80::1%eth0 -> fe80::1)
  const zoneIndex = clean.indexOf('%');
  if (zoneIndex !== -1) {
    clean = clean.slice(0, zoneIndex);
  }

  return clean;
};

/**
 * Checks if an IP is loopback / localhost.
 * Handles 127.0.0.0/8 block, ::1, and 'localhost'.
 * @param {string} ip
 * @returns {boolean}
 */
export const isLocalhostIp = (ip) => {
  const clean = normalizeIp(ip);
  if (!clean) return false;
  const lower = clean.toLowerCase();
  if (lower === '::1' || lower === 'localhost') return true;

  // Strict IPv4 127.0.0.0/8 loopback validation (prevents '127.attacker.com' or '127.0.0.1.evil.com' spoofing)
  const parts = lower.split('.');
  if (parts.length === 4 && parts[0] === '127') {
    return parts.slice(1).every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
  }

  return false;
};

/**
 * Converts an IPv4 string to a 32-bit integer.
 */
const ipToLong = (ip) => {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
};

/**
 * Checks if an IP address matches a CIDR notation, exact IP, or loopback keyword.
 */
export const ipMatchesCidr = (ip, pattern) => {
  const cleanIp = normalizeIp(ip);
  const cleanPattern = normalizeIp(pattern);

  if (!cleanIp || !cleanPattern) return false;
  if (cleanPattern === '*') return true;

  // Support standard reverse proxy aliases: loopback, localhost, private, uniquelocal, linklocal
  const lowerPattern = cleanPattern.toLowerCase();
  if (lowerPattern === 'loopback' || lowerPattern === 'localhost') {
    return isLocalhostIp(cleanIp);
  }
  if (lowerPattern === 'private') {
    return isLocalhostIp(cleanIp) ||
      ipMatchesCidr(cleanIp, '10.0.0.0/8') ||
      ipMatchesCidr(cleanIp, '172.16.0.0/12') ||
      ipMatchesCidr(cleanIp, '192.168.0.0/16') ||
      ipMatchesCidr(cleanIp, '169.254.0.0/16');
  }
  if (lowerPattern === 'uniquelocal') {
    return ipMatchesCidr(cleanIp, '10.0.0.0/8') ||
      ipMatchesCidr(cleanIp, '172.16.0.0/12') ||
      ipMatchesCidr(cleanIp, '192.168.0.0/16');
  }
  if (lowerPattern === 'linklocal') {
    return ipMatchesCidr(cleanIp, '169.254.0.0/16');
  }

  if (!cleanPattern.includes('/')) {
    return cleanIp.toLowerCase() === cleanPattern.toLowerCase();
  }

  const slashParts = cleanPattern.split('/');
  if (slashParts.length !== 2) return false;
  const [range, bitsStr] = slashParts;

  if (!/^\d{1,2}$/.test(bitsStr)) return false;
  const bits = parseInt(bitsStr, 10);
  if (bits < 0 || bits > 32) return false;

  const ipParts = cleanIp.split('.');
  const rangeParts = range.split('.');
  if (ipParts.length !== 4 || rangeParts.length !== 4) return false;

  const isValidOctet = (part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255;
  if (!ipParts.every(isValidOctet) || !rangeParts.every(isValidOctet)) return false;

  const ipLong = ipToLong(cleanIp);
  const rangeLong = ipToLong(range);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;

  return ((ipLong & mask) >>> 0) === ((rangeLong & mask) >>> 0);
};

/**
 * Retrieves the configured list of trusted reverse proxies from environment variables.
 * @returns {string[]}
 */
export const getTrustedProxies = () => {
  const envVal = process.env.TRUSTED_PROXIES || process.env.TRUSTED_PROXY_IPS || '';
  if (!envVal.trim()) return [];
  return envVal
    .split(',')
    .map(p => normalizeIp(p))
    .filter(Boolean);
};

/**
 * Validates whether a given connection IP matches the configured trusted proxies.
 * @param {string} connectionIp
 * @returns {boolean}
 */
export const isConnectionFromTrustedProxy = (connectionIp) => {
  const cleanIp = normalizeIp(connectionIp);
  if (!cleanIp) return false;

  const trustedList = getTrustedProxies();
  if (trustedList.length === 0) {
    return false;
  }

  return trustedList.some(pattern => ipMatchesCidr(cleanIp, pattern));
};

/**
 * Retrieves allowed Safaricom IP patterns (supports env overrides and CIDR ranges).
 * @returns {string[]}
 */
export const getSafaricomAllowedPatterns = () => {
  const envVal = process.env.SAFARICOM_IPS || process.env.SAFARICOM_IP_WHITELIST || '';
  if (envVal.trim()) {
    return envVal
      .split(',')
      .map(p => normalizeIp(p))
      .filter(Boolean);
  }
  return [...safaricomIPs, ...safaricomSubnets];
};

/**
 * Validates whether a client IP matches Safaricom's official whitelist or subnets.
 * @param {string} ip
 * @returns {boolean}
 */
export const isSafaricomIp = (ip) => {
  const cleanIp = normalizeIp(ip);
  if (!cleanIp) return false;
  const allowed = getSafaricomAllowedPatterns();
  return allowed.some(pattern => ipMatchesCidr(cleanIp, pattern));
};

/**
 * Safely extracts the client IP address.
 * 
 * Security rules:
 * 1. Checks the direct TCP connection address (socket.remoteAddress).
 * 2. If the connection does NOT originate from a trusted proxy:
 *    - Never trusts X-Forwarded-For headers.
 *    - Flags any attempt by an untrusted connection to supply X-Forwarded-For as an untrusted spoofing attempt.
 * 3. If the connection DOES originate from a verified trusted proxy:
 *    - Parses X-Forwarded-For from right to left, stripping trusted proxies.
 *    - Selects the first untrusted IP in the chain (the true client that connected to the proxy).
 *    - If all IPs in chain are trusted proxies, falls back to the outermost client (ipList[0]).
 * 
 * @param {import('express').Request} req
 * @returns {{ clientIp: string, isTrustedProxy: boolean, hasUntrustedXff: boolean }}
 */
export const getSecureClientIp = (req) => {
  if (!req) {
    return {
      clientIp: '',
      isTrustedProxy: false,
      hasUntrustedXff: false
    };
  }

  const rawConnectionIp = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  const connectionIp = normalizeIp(rawConnectionIp);

  const rawXff = req.headers ? req.headers['x-forwarded-for'] : undefined;
  const hasXffHeader = rawXff !== undefined && rawXff !== null && String(rawXff).trim() !== '';

  const trustedProxy = isConnectionFromTrustedProxy(connectionIp);

  if (!trustedProxy) {
    // Direct connection without a verified reverse proxy
    if (hasXffHeader) {
      return {
        clientIp: connectionIp,
        isTrustedProxy: false,
        hasUntrustedXff: true
      };
    }
    return {
      clientIp: connectionIp,
      isTrustedProxy: false,
      hasUntrustedXff: false
    };
  }

  // Connection is from a verified trusted reverse proxy
  if (!hasXffHeader) {
    return {
      clientIp: connectionIp,
      isTrustedProxy: true,
      hasUntrustedXff: false
    };
  }

  // Parse X-Forwarded-For header chain: "client, proxy1, proxy2"
  const xffString = Array.isArray(rawXff) ? rawXff.join(',') : String(rawXff);
  const ipList = xffString
    .split(',')
    .map(ip => normalizeIp(ip))
    .filter(Boolean);

  if (ipList.length === 0) {
    return {
      clientIp: connectionIp,
      isTrustedProxy: true,
      hasUntrustedXff: false
    };
  }

  const trustedList = getTrustedProxies();

  // Walk the chain backwards from right to left, stripping any trusted proxies in the chain.
  // The first untrusted IP from the right is the genuine client address.
  // If all IPs in the chain are trusted proxies, fall back to the outermost client (ipList[0]).
  let resolvedIp = ipList[0];
  for (let i = ipList.length - 1; i >= 0; i--) {
    const current = ipList[i];
    const isCurrentTrusted = trustedList.some(pattern => ipMatchesCidr(current, pattern));
    if (!isCurrentTrusted) {
      resolvedIp = current;
      break;
    }
  }

  return {
    clientIp: resolvedIp,
    isTrustedProxy: true,
    hasUntrustedXff: false
  };
};

/**
 * Safaricom Daraja Webhook IP Whitelist Middleware
 * Protects M-Pesa callback endpoints from IP spoofing attacks.
 */
export const safaricomIpWhitelist = (req, res, next) => {
  if (!req || !res) {
    return next ? next() : undefined;
  }

  const { clientIp, hasUntrustedXff } = getSecureClientIp(req);

  // Reject untrusted connections attempting to supply X-Forwarded-For headers
  if (hasUntrustedXff) {
    const rawXff = req.headers ? req.headers['x-forwarded-for'] : '';
    console.warn(`🚨 SECURITY ALERT: Blocked spoofed X-Forwarded-For attempt from untrusted connection (${clientIp}): "${rawXff}"`);
    return res.status(403).json({
      success: false,
      message: "Forbidden: Invalid IP Address"
    });
  }

  // Allow legitimate direct localhost requests for local development/testing.
  // Must be a direct socket connection from loopback without spoofed forwarding headers.
  const rawConnectionIp = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  const rawXffHeader = req.headers ? req.headers['x-forwarded-for'] : undefined;
  const isDirectLocalhost = isLocalhostIp(rawConnectionIp) && 
    (rawXffHeader === undefined || rawXffHeader === null || String(rawXffHeader).trim() === '');
  
  if (isDirectLocalhost && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCAL_WEBHOOKS === 'true')) {
    console.log(`🔓 Legitimate local request allowed from ${clientIp}`);
    return next();
  }

  // Verify against official Safaricom whitelist or CIDR subnets
  if (isSafaricomIp(clientIp)) {
    return next();
  }

  // Block unauthorized requests
  console.warn(`🚨 SECURITY ALERT: Blocked fake callback attempt from IP: ${clientIp}`);
  return res.status(403).json({
    success: false,
    message: "Forbidden: Invalid IP Address"
  });
};

export default safaricomIpWhitelist;
