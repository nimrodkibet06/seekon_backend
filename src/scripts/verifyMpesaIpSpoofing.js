/**
 * Automated Verification Script for M-Pesa Webhook IP Whitelist & Anti-Spoofing
 * 
 * Verifies that:
 * 1. Requests with spoofed X-Forwarded-For headers matching Safaricom IPs are rejected (HTTP 403).
 * 2. Multi-hop spoofing attempts are rejected (HTTP 403).
 * 3. Alternative Safaricom IP ranges cannot be spoofed (HTTP 403).
 * 4. Legitimate direct local requests are processed without 403 rejection.
 * 5. Spoofed IPs through trusted proxies are detected and rejected (HTTP 403).
 * 6. Genuine Safaricom IPs forwarded by verified trusted proxies are allowed.
 * 7. Port-inclusive Safaricom IPs forwarded by trusted proxies are normalized and allowed.
 * 8. Newly added official Safaricom IP (196.201.214.208) is accepted via trusted proxy.
 * 9. Attacker spoofing 127.0.0.1 through a trusted proxy is rejected (HTTP 403).
 * 10. Direct attacker spoofing 127.0.0.1 locally is rejected (HTTP 403).
 * 11. Daraja CIDR subnets are supported and correctly match.
 * 12. Quoted Safaricom IPs forwarded by trusted proxies are normalized and accepted.
 * 13. Bracketed IPv4-mapped IPv6 with port is normalized and accepted via trusted proxy.
 * 14. Uppercase IPv4-mapped IPv6 is recognized and accepted via trusted proxy.
 * 15. Security architecture unit validations for loopback aliases, CIDR edge cases, brackets, ports, and null safety.
 */

import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import paymentRoutes from '../routes/paymentRoutes.js';
import {
  safaricomIPs,
  safaricomSubnets,
  isSafaricomIp,
  getSecureClientIp,
  isConnectionFromTrustedProxy,
  ipMatchesCidr,
  normalizeIp,
  isLocalhostIp
} from '../middleware/safaricomIpWhitelist.js';

// Simulated M-Pesa webhook callback body
const mockMpesaCallbackPayload = {
  Body: {
    stkCallback: {
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_TEST_VERIFY_12345",
      ResultCode: 0,
      ResultDesc: "The service request is processed successfully.",
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: 1.00 },
          { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
          { Name: "TransactionDate", Value: 20261005120000 },
          { Name: "PhoneNumber", Value: 254712345678 }
        ]
      }
    }
  }
};

/**
 * Helper to perform an HTTP request and return status, headers, and parsed JSON body.
 */
function sendRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => {
        rawData += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch {
          json = rawData;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

/**
 * Creates and starts a test Express server mirroring server.js configuration.
 */
function createTestServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/payment', paymentRoutes);

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('🛡️  M-PESA WEBHOOK IP SPOOFING VERIFICATION TEST SUITE (ADVERSARIAL)');
  console.log('='.repeat(70));
  console.log(`📋 Known Safaricom IPs: ${safaricomIPs.join(', ')} (${safaricomIPs.length} total)`);
  console.log(`🌐 Safaricom Subnets: ${safaricomSubnets.join(', ')}`);
  console.log(`📍 Environment: NODE_ENV=${process.env.NODE_ENV || 'development'}`);

  // Connect MongoDB if MONGO_URI is present (needed for downstream controller in tests 4, 6, 7, 8)
  const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
  if (mongoUri && mongoose.connection.readyState === 0) {
    try {
      console.log('🔌 Connecting to database for downstream order resolution...');
      await mongoose.connect(mongoUri, {
        family: 4,
        serverSelectionTimeoutMS: 5000
      });
      console.log('✅ Database connected.');
    } catch (dbErr) {
      console.warn('⚠️ MongoDB connection warning:', dbErr.message);
      mongoose.set('bufferCommands', false);
    }
  }

  console.log('-'.repeat(70));

  const { server, port } = await createTestServer();
  const host = '127.0.0.1';
  let passedCount = 0;
  let failedCount = 0;

  function assert(title, condition, detail = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${title}`);
      if (detail) console.log(`     └─ ${detail}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${title}`);
      if (detail) console.error(`     └─ ${detail}`);
      failedCount++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Direct Attack - Spoofed Safaricom IP via X-Forwarded-For
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Attack Simulation: Untrusted caller spoofing Safaricom IP directly');
    const spoofedIp = safaricomIPs[0]; // '196.201.214.200'
    delete process.env.TRUSTED_PROXIES;

    const res1 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': spoofedIp
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Spoofed request from untrusted caller rejected with HTTP 403',
      res1.statusCode === 403,
      `Received status: ${res1.statusCode}, expected: 403 (Forbidden)`
    );
    assert(
      'Response body indicates Forbidden: Invalid IP Address',
      res1.body?.success === false && String(res1.body?.message).includes('Forbidden'),
      `Response body: ${JSON.stringify(res1.body)}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Multi-hop Spoofing Attack - Attacker prepending Safaricom IP
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Attack Simulation: Attacker prepending Safaricom IP in multi-hop header');
    const multiHopSpoof = `${safaricomIPs[1]}, 198.51.100.23`;

    const res2 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': multiHopSpoof
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Multi-hop spoofed request rejected with HTTP 403',
      res2.statusCode === 403,
      `Received status: ${res2.statusCode}, expected: 403`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Spoofed Secondary Safaricom IP from range
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Attack Simulation: Spoofing alternative Daraja IP');
    const alternativeIp = safaricomIPs[5]; // '196.201.212.127'

    const res3 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': alternativeIp
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Alternative Safaricom IP spoof rejected with HTTP 403',
      res3.statusCode === 403,
      `Received status: ${res3.statusCode}, expected: 403`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Legitimate Local Request (Direct localhost without spoofed header)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Legitimate Local Request: Direct call without X-Forwarded-For');

    const res4 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Legitimate local request is NOT rejected with 403 (reaches controller)',
      res4.statusCode !== 403,
      `Received status: ${res4.statusCode} (404/200 expected from controller; NOT 403 Forbidden)`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Trusted Proxy Attack Simulation - Multi-hop spoofing properly stripped
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Trusted Proxy Attack Simulation: Attacker connecting through trusted proxy');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const proxySpoofedHeader = `${safaricomIPs[0]}, 203.0.113.88`;

    const res5 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': proxySpoofedHeader
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Trusted proxy evaluates genuine connecting client (203.0.113.88) and rejects with 403',
      res5.statusCode === 403,
      `Received status: ${res5.statusCode}, expected: 403`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Trusted Proxy Scenario - Genuine Safaricom IP forwarded
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Valid IP Request: Genuine Safaricom IP forwarded through trusted proxy');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const genuineSafaricomHeader = safaricomIPs[2]; // '196.201.213.114'

    const res6 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': genuineSafaricomHeader
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Valid Safaricom IP forwarded by trusted proxy is accepted (not 403)',
      res6.statusCode !== 403,
      `Received status: ${res6.statusCode} (controller responded, NOT 403)`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Port-inclusive X-Forwarded-For through trusted proxy
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Port Handling: Safaricom IP with port forwarded by trusted proxy');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const portIncludedHeader = `${safaricomIPs[0]}:443`; // '196.201.214.200:443'

    const res7 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': portIncludedHeader
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Safaricom IP with client port is properly normalized and accepted (not 403)',
      res7.statusCode !== 403,
      `Received status: ${res7.statusCode} (controller responded, NOT 403)`
    );

    // -------------------------------------------------------------------------
    // TEST 8: Newly added official Safaricom IP (196.201.214.208)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Official IP Coverage: 196.201.214.208 accepted via trusted proxy');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const res8 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '196.201.214.208'
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Official Safaricom IP 196.201.214.208 is recognized and accepted (not 403)',
      res8.statusCode !== 403,
      `Received status: ${res8.statusCode} (controller responded, NOT 403)`
    );

    // -------------------------------------------------------------------------
    // TEST 9: Localhost spoofing attempt through trusted proxy
    // -------------------------------------------------------------------------
    console.log('\n[TEST 9] Localhost Spoofing Defense: Attacker sending XFF 127.0.0.1 via trusted proxy');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const res9 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '127.0.0.1'
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Forwarded 127.0.0.1 is NOT treated as a direct local request and is rejected with 403',
      res9.statusCode === 403,
      `Received status: ${res9.statusCode}, expected: 403`
    );

    // -------------------------------------------------------------------------
    // TEST 10: Direct caller spoofing 127.0.0.1 via XFF header
    // -------------------------------------------------------------------------
    console.log('\n[TEST 10] Direct Localhost Spoofing Defense: Direct caller with XFF 127.0.0.1');
    delete process.env.TRUSTED_PROXIES;

    const res10 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '127.0.0.1'
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Direct caller attempting to supply XFF header 127.0.0.1 is rejected with 403',
      res10.statusCode === 403,
      `Received status: ${res10.statusCode}, expected: 403`
    );

    // -------------------------------------------------------------------------
    // TEST 11: Safaricom Subnet CIDR Validation
    // -------------------------------------------------------------------------
    console.log('\n[TEST 11] Subnet Support: Validate Daraja CIDR ranges');
    assert(
      'isSafaricomIp matches valid IP within Daraja 196.201.214.0/24 subnet',
      isSafaricomIp('196.201.214.50') === true
    );
    assert(
      'isSafaricomIp matches valid IP within Daraja 196.201.213.0/24 subnet',
      isSafaricomIp('196.201.213.100') === true
    );
    assert(
      'isSafaricomIp rejects IP outside Daraja subnets (196.201.215.1)',
      isSafaricomIp('196.201.215.1') === false
    );

    // -------------------------------------------------------------------------
    // TEST 12: Quoted Safaricom IP through trusted proxy (RFC 7239 header compliance)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 12] Quoted IP Handling: Quoted Safaricom IP forwarded by trusted proxy');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const quotedHeader = `"${safaricomIPs[0]}"`;

    const res12 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': quotedHeader
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Quoted Safaricom IP forwarded by trusted proxy is normalized and accepted (not 403)',
      res12.statusCode !== 403,
      `Received status: ${res12.statusCode} (controller responded, NOT 403)`
    );

    // -------------------------------------------------------------------------
    // TEST 13: Bracketed IPv4-mapped IPv6 with port through trusted proxy
    // -------------------------------------------------------------------------
    console.log('\n[TEST 13] Bracketed IPv4-mapped IPv6 with port: [::ffff:196.201.214.200]:443');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const bracketedMappedHeader = `[::ffff:${safaricomIPs[0]}]:443`;

    const res13 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': bracketedMappedHeader
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Bracketed IPv4-mapped IPv6 with port is normalized and accepted (not 403)',
      res13.statusCode !== 403,
      `Received status: ${res13.statusCode} (controller responded, NOT 403)`
    );

    // -------------------------------------------------------------------------
    // TEST 14: Uppercase IPv4-mapped IPv6 through trusted proxy
    // -------------------------------------------------------------------------
    console.log('\n[TEST 14] Uppercase IPv4-mapped IPv6: ::FFFF:196.201.214.200');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const uppercaseMappedHeader = `::FFFF:${safaricomIPs[0]}`;

    const res14 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': uppercaseMappedHeader
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Uppercase IPv4-mapped IPv6 is recognized and accepted (not 403)',
      res14.statusCode !== 403,
      `Received status: ${res14.statusCode} (controller responded, NOT 403)`
    );

    // -------------------------------------------------------------------------
    // TEST 15: Attack Simulation: Pseudo-localhost hostname spoofing via trusted proxy
    // -------------------------------------------------------------------------
    console.log('\n[TEST 15] Attack Simulation: Attacker sending pseudo-localhost hostname (127.attacker.com) via trusted proxy');
    process.env.TRUSTED_PROXIES = '127.0.0.1';

    const res15 = await sendRequest({
      hostname: host,
      port: port,
      path: '/api/payment/mpesa-callback',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '127.attacker.com'
      }
    }, mockMpesaCallbackPayload);

    assert(
      'Pseudo-localhost hostname spoof (127.attacker.com) is rejected with 403',
      res15.statusCode === 403,
      `Received status: ${res15.statusCode}, expected: 403`
    );

    // -------------------------------------------------------------------------
    // TEST 16: Security Architecture Unit Assertions
    // -------------------------------------------------------------------------
    console.log('\n[TEST 16] Security Architecture Unit Assertions');
    delete process.env.TRUSTED_PROXIES;

    // Untrusted connection sending XFF
    const untrustedReq = {
      socket: { remoteAddress: '203.0.113.5' },
      headers: { 'x-forwarded-for': '196.201.214.200' }
    };
    const checkUntrusted = getSecureClientIp(untrustedReq);
    assert(
      'getSecureClientIp flags untrusted connection sending XFF as hasUntrustedXff: true',
      checkUntrusted.hasUntrustedXff === true && checkUntrusted.isTrustedProxy === false,
      `Result: ${JSON.stringify(checkUntrusted)}`
    );

    // Direct connection without XFF
    const directReq = {
      socket: { remoteAddress: '196.201.214.200' },
      headers: {}
    };
    const checkDirect = getSecureClientIp(directReq);
    assert(
      'getSecureClientIp resolves true connection address when no XFF',
      checkDirect.clientIp === '196.201.214.200' && checkDirect.hasUntrustedXff === false,
      `Result: ${JSON.stringify(checkDirect)}`
    );

    // Trusted proxy chain parsing
    process.env.TRUSTED_PROXIES = '10.0.0.1, 10.0.0.2';
    const trustedReq = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'x-forwarded-for': '196.201.214.200, 198.51.100.99, 10.0.0.2' }
    };
    const checkTrustedChain = getSecureClientIp(trustedReq);
    assert(
      'getSecureClientIp strips trusted proxies and extracts genuine client from chain',
      checkTrustedChain.clientIp === '198.51.100.99' && checkTrustedChain.isTrustedProxy === true,
      `Extracted IP: ${checkTrustedChain.clientIp}, expected: 198.51.100.99`
    );

    // All-trusted proxy chain fallback (should return outermost client ipList[0])
    const allTrustedReq = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' }
    };
    const checkAllTrusted = getSecureClientIp(allTrustedReq);
    assert(
      'getSecureClientIp falls back to outermost client (ipList[0]) when all chain IPs are trusted',
      checkAllTrusted.clientIp === '10.0.0.2'
    );

    // Normalization edge cases: brackets and ports
    assert(
      'normalizeIp strips IPv6 brackets and port ([::1]:3000 -> ::1)',
      normalizeIp('[::1]:3000') === '::1'
    );
    assert(
      'normalizeIp strips IPv4 port (192.168.1.1:8080 -> 192.168.1.1)',
      normalizeIp('192.168.1.1:8080') === '192.168.1.1'
    );
    assert(
      'normalizeIp strips ::ffff: and port (::ffff:192.168.1.1:8080 -> 192.168.1.1)',
      normalizeIp('::ffff:192.168.1.1:8080') === '192.168.1.1'
    );
    assert(
      'normalizeIp strips bracketed IPv4-mapped IPv6 with port ([::ffff:192.168.1.1]:8080 -> 192.168.1.1)',
      normalizeIp('[::ffff:192.168.1.1]:8080') === '192.168.1.1'
    );
    assert(
      'normalizeIp normalizes uppercase ::FFFF: (::FFFF:192.168.1.1 -> 192.168.1.1)',
      normalizeIp('::FFFF:192.168.1.1') === '192.168.1.1'
    );
    assert(
      'normalizeIp normalizes bracketed uppercase [::FFFF:192.168.1.1]:443 -> 192.168.1.1',
      normalizeIp('[::FFFF:192.168.1.1]:443') === '192.168.1.1'
    );
    assert(
      'normalizeIp strips RFC 7239 double and single quotes ("192.168.1.1" -> 192.168.1.1)',
      normalizeIp('"192.168.1.1"') === '192.168.1.1' && normalizeIp("'192.168.1.1'") === '192.168.1.1'
    );
    assert(
      'normalizeIp strips IPv6 zone index (fe80::1%eth0 -> fe80::1)',
      normalizeIp('fe80::1%eth0') === 'fe80::1'
    );
    assert(
      'normalizeIp handles bracketed IPv4 with port ([192.168.1.1]:8080 -> 192.168.1.1)',
      normalizeIp('[192.168.1.1]:8080') === '192.168.1.1'
    );

    // Loopback block validation
    assert(
      'isLocalhostIp recognizes 127.0.0.2 as loopback',
      isLocalhostIp('127.0.0.2') === true
    );
    assert(
      'isLocalhostIp recognizes [::1]:3000 as loopback',
      isLocalhostIp('[::1]:3000') === true
    );
    assert(
      'isLocalhostIp recognizes ::FFFF:127.0.0.1 as loopback',
      isLocalhostIp('::FFFF:127.0.0.1') === true
    );
    assert(
      'isLocalhostIp recognizes [::ffff:127.0.0.1]:8080 as loopback',
      isLocalhostIp('[::ffff:127.0.0.1]:8080') === true
    );
    assert(
      'isLocalhostIp strictly rejects pseudo-localhost hostnames and invalid octets (127.attacker.com, 127.0.0.1.evil.com, 127.999.0.1, 127., 127.foo)',
      isLocalhostIp('127.attacker.com') === false &&
      isLocalhostIp('127.0.0.1.evil.com') === false &&
      isLocalhostIp('127.999.0.1') === false &&
      isLocalhostIp('127.') === false &&
      isLocalhostIp('127.foo') === false
    );

    // CIDR octet boundaries and robustness against malformed patterns
    assert(
      'ipMatchesCidr matches IP within CIDR subnet (10.0.0.5 in 10.0.0.0/8)',
      ipMatchesCidr('10.0.0.5', '10.0.0.0/8') === true
    );
    assert(
      'ipMatchesCidr rejects IP outside CIDR subnet (192.168.1.1 in 10.0.0.0/8)',
      ipMatchesCidr('192.168.1.1', '10.0.0.0/8') === false
    );
    assert(
      'ipMatchesCidr safely handles malformed IP strings without NaN corruption',
      ipMatchesCidr('10..0.1', '10.0.0.0/8') === false && ipMatchesCidr('invalid', '10.0.0.0/8') === false
    );
    assert(
      'ipMatchesCidr rejects malformed CIDR bit suffixes (10.0.0.0/8junk, 10.0.0.0/8/extra, 10.0.0.0/33)',
      ipMatchesCidr('10.0.0.1', '10.0.0.0/8junk') === false &&
      ipMatchesCidr('10.0.0.1', '10.0.0.0/8/extra') === false &&
      ipMatchesCidr('10.0.0.1', '10.0.0.0/33') === false
    );
    assert(
      'ipMatchesCidr supports loopback and localhost keyword aliases and rejects pseudo-localhost',
      ipMatchesCidr('127.0.0.1', 'loopback') === true &&
      ipMatchesCidr('::1', 'loopback') === true &&
      ipMatchesCidr('127.0.0.1', 'localhost') === true &&
      ipMatchesCidr('192.168.1.1', 'loopback') === false &&
      ipMatchesCidr('127.attacker.com', 'loopback') === false
    );
    assert(
      'ipMatchesCidr supports private, uniquelocal, and linklocal proxy keyword aliases',
      ipMatchesCidr('10.0.0.1', 'private') === true &&
      ipMatchesCidr('172.16.5.1', 'private') === true &&
      ipMatchesCidr('192.168.1.1', 'private') === true &&
      ipMatchesCidr('127.0.0.1', 'private') === true &&
      ipMatchesCidr('203.0.113.1', 'private') === false &&
      ipMatchesCidr('10.0.0.1', 'uniquelocal') === true &&
      ipMatchesCidr('169.254.1.1', 'linklocal') === true
    );
    assert(
      'ipMatchesCidr performs case-insensitive comparison for IPv6',
      ipMatchesCidr('2001:db8::1', '2001:DB8::1') === true
    );

    // Null safety: unhandled exception avoidance
    assert(
      'getSecureClientIp gracefully handles undefined req and req without headers',
      getSecureClientIp(null).clientIp === '' &&
      getSecureClientIp({}).clientIp === '' &&
      getSecureClientIp({ socket: { remoteAddress: '1.2.3.4' } }).clientIp === '1.2.3.4'
    );

  } finally {
    // Clean up test server, database connection, and environment
    server.close();
    delete process.env.TRUSTED_PROXIES;
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('='.repeat(70));

  if (failedCount > 0) {
    console.error('❌ Test suite failed!');
    process.exit(1);
  } else {
    console.log('✅ All M-Pesa IP spoofing verification tests PASSED successfully!\n');
    process.exit(0);
  }
}

// Execute test suite
runTests().catch((err) => {
  console.error('💥 Fatal error running test suite:', err);
  process.exit(1);
});
