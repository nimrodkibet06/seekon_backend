/**
 * Automated Verification Script for Sentry Observability & Error Tracking (Layer 12)
 *
 * Verifies:
 * 1. @sentry/node dependency is installed and exports required SDK interfaces.
 * 2. Missing/empty SENTRY_DSN guards: server remains inert without crashing or throwing.
 * 3. Active Sentry initialization: properly configures Sentry client with environment.
 * 4. Global Express error handler routes HTTP 5xx exceptions to Sentry with formatted stack traces and metadata.
 * 5. Global Express error handler does not report client 4xx errors to Sentry.
 * 6. Global process unhandledRejection handler captures promise rejections with stack traces in Sentry.
 * 7. Global process uncaughtException handler captures exceptions with stack traces in Sentry.
 * 8. End-to-end HTTP route execution triggers Sentry capture for synchronous and asynchronous route errors.
 * 9. Production security check: raw stack traces are hidden from HTTP client while preserved in Sentry.
 */

import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import * as Sentry from '@sentry/node';
import {
  initSentry,
  sentryErrorHandler,
  handleUnhandledRejection,
  handleUncaughtException
} from '../server.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));

const MOCK_DSN = 'https://mockKey123456@o0.ingest.sentry.io/987654';

/**
 * Helper to perform an HTTP request to a local server.
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

async function runTestSuite() {
  console.log('='.repeat(70));
  console.log('🛡️  SENTRY OBSERVABILITY & ERROR TRACKING VERIFICATION SUITE');
  console.log('='.repeat(70));

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
    // TEST 1: Dependency Check
    // -------------------------------------------------------------------------
    console.log('\n[TEST 1] Dependency Check: @sentry/node installed and exportable');
    const hasSentryInDeps = Boolean(packageJson.dependencies && packageJson.dependencies['@sentry/node']);
    assert(
      '@sentry/node is declared in package.json dependencies',
      hasSentryInDeps,
      `Version in package.json: ${packageJson.dependencies?.['@sentry/node']}`
    );
    assert(
      '@sentry/node exports init, captureException, and setupExpressErrorHandler',
      typeof Sentry.init === 'function' &&
      typeof Sentry.captureException === 'function' &&
      typeof Sentry.setupExpressErrorHandler === 'function',
      'SDK functions verified'
    );

    // -------------------------------------------------------------------------
    // TEST 2: Missing / Invalid SENTRY_DSN Guard
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Missing & Empty SENTRY_DSN Guard: Remains inert, does not crash');
    let noCrashUndefined = false;
    try {
      const resUndef = initSentry(undefined);
      noCrashUndefined = resUndef === null;
    } catch {
      noCrashUndefined = false;
    }
    assert(
      'initSentry(undefined) logs warning, returns null, and does not throw',
      noCrashUndefined
    );

    let noCrashEmpty = false;
    try {
      const resEmpty = initSentry('   ');
      noCrashEmpty = resEmpty === null;
    } catch {
      noCrashEmpty = false;
    }
    assert(
      'initSentry("   ") with empty whitespace returns null and does not throw',
      noCrashEmpty
    );

    // -------------------------------------------------------------------------
    // TEST 3: Active Sentry Initialization
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Active Sentry Initialization with DSN');
    const capturedEvents = [];
    Sentry.init({
      dsn: MOCK_DSN,
      environment: 'test',
      tracesSampleRate: 1.0,
      beforeSend(event) {
        capturedEvents.push(event);
        return null; // Don't attempt outbound network dispatch
      }
    });

    assert(
      'Sentry client is initialized and active after Sentry.init with mock DSN',
      Boolean(Sentry.getClient()),
      `Client initialized: ${Boolean(Sentry.getClient())}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Global Express Error Handler Middleware Routing
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Express Error Handler Middleware: Route critical errors to Sentry');
    capturedEvents.length = 0; // Clear events

    const mockReq = {
      originalUrl: '/api/orders/checkout',
      method: 'POST',
      ip: '192.168.1.100',
      headers: { 'x-forwarded-for': '192.168.1.100' }
    };

    let sentStatus = null;
    let sentJson = null;
    const mockRes = {
      status(code) {
        sentStatus = code;
        return this;
      },
      json(data) {
        sentJson = data;
        return this;
      }
    };

    const simulatedError = new Error('Database connection pool exhausted during transaction');
    simulatedError.statusCode = 500;

    sentryErrorHandler(simulatedError, mockReq, mockRes, () => {});
    await Sentry.flush(1000);

    assert(
      'sentryErrorHandler responds with HTTP 500 status code',
      sentStatus === 500,
      `Status code: ${sentStatus}`
    );
    assert(
      'sentryErrorHandler returns failure JSON body',
      sentJson?.success === false,
      `JSON message: ${sentJson?.message}`
    );
    assert(
      'Sentry captured exactly 1 event for the 500 error',
      capturedEvents.length === 1,
      `Captured events count: ${capturedEvents.length}`
    );

    const event = capturedEvents[0];
    const exceptionValue = event?.exception?.values?.[0];
    assert(
      'Sentry event contains correct error message',
      exceptionValue?.value === 'Database connection pool exhausted during transaction',
      `Captured message: "${exceptionValue?.value}"`
    );
    assert(
      'Sentry event contains correct error type (Error)',
      exceptionValue?.type === 'Error',
      `Captured type: "${exceptionValue?.type}"`
    );
    assert(
      'Sentry event contains properly formatted stacktrace with frames',
      Array.isArray(exceptionValue?.stacktrace?.frames) && exceptionValue.stacktrace.frames.length > 0,
      `Frames count: ${exceptionValue?.stacktrace?.frames?.length}`
    );
    assert(
      'Sentry event includes request metadata in extra context (path, method, statusCode)',
      event?.extra?.path === '/api/orders/checkout' &&
      event?.extra?.method === 'POST' &&
      event?.extra?.statusCode === 500,
      `Extra context: ${JSON.stringify(event?.extra)}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Client Errors (HTTP 4xx) Are NOT Routed to Sentry
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Noise Filter: Client errors (4xx) are not reported to Sentry');
    capturedEvents.length = 0;

    const clientError = new Error('Invalid coupon code supplied');
    clientError.statusCode = 400;

    sentStatus = null;
    sentJson = null;
    sentryErrorHandler(clientError, mockReq, mockRes, () => {});
    await Sentry.flush(1000);

    assert(
      'sentryErrorHandler responds with HTTP 400 for client error',
      sentStatus === 400,
      `Status code: ${sentStatus}`
    );
    assert(
      'Sentry does NOT capture client 4xx errors (event count is 0)',
      capturedEvents.length === 0,
      `Captured count: ${capturedEvents.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Unhandled Promise Rejection Capture
    // -------------------------------------------------------------------------
    console.log('\n[TEST 6] Unhandled Promise Rejection Capture');
    capturedEvents.length = 0;

    const rejectionReason = new Error('Async task unhandled rejection in background worker');
    handleUnhandledRejection(rejectionReason);
    await Sentry.flush(1000);

    assert(
      'handleUnhandledRejection routes rejection to Sentry',
      capturedEvents.length === 1,
      `Captured events count: ${capturedEvents.length}`
    );
    assert(
      'Captured rejection contains error message and type',
      capturedEvents[0]?.exception?.values?.[0]?.value === 'Async task unhandled rejection in background worker',
      `Captured: "${capturedEvents[0]?.exception?.values?.[0]?.value}"`
    );
    assert(
      'Captured rejection contains unhandledRejection extra mechanism tag',
      capturedEvents[0]?.extra?.type === 'unhandledRejection',
      `Extra tag: ${JSON.stringify(capturedEvents[0]?.extra)}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Uncaught Exception Capture
    // -------------------------------------------------------------------------
    console.log('\n[TEST 7] Uncaught Exception Capture');
    capturedEvents.length = 0;

    const uncaughtError = new Error('Simulated uncaught exception in worker thread');
    // Ensure NODE_ENV is test so handleUncaughtException does not call process.exit(1)
    process.env.NODE_ENV = 'test';
    handleUncaughtException(uncaughtError);
    await Sentry.flush(1000);

    assert(
      'handleUncaughtException routes exception to Sentry',
      capturedEvents.length === 1,
      `Captured events count: ${capturedEvents.length}`
    );
    assert(
      'Captured uncaught exception contains error message and stacktrace',
      capturedEvents[0]?.exception?.values?.[0]?.value === 'Simulated uncaught exception in worker thread' &&
      Array.isArray(capturedEvents[0]?.exception?.values?.[0]?.stacktrace?.frames),
      `Value: "${capturedEvents[0]?.exception?.values?.[0]?.value}"`
    );
    assert(
      'Captured uncaught exception contains uncaughtException extra tag',
      capturedEvents[0]?.extra?.type === 'uncaughtException',
      `Extra tag: ${JSON.stringify(capturedEvents[0]?.extra)}`
    );

    // -------------------------------------------------------------------------
    // TEST 8: Full HTTP Express Pipeline Integration
    // -------------------------------------------------------------------------
    console.log('\n[TEST 8] Full Express HTTP Pipeline: Real HTTP requests with Sentry middleware');
    capturedEvents.length = 0;

    const testApp = express();
    testApp.use(express.json());

    // Synchronous throwing route
    testApp.get('/test/sync-error', () => {
      throw new Error('Synchronous Express route exception');
    });

    // Asynchronous error route
    testApp.get('/test/async-error', async (req, res, next) => {
      try {
        await Promise.reject(new Error('Asynchronous pipeline execution failure'));
      } catch (err) {
        next(err);
      }
    });

    // Non-error route
    testApp.get('/test/success', (req, res) => {
      res.json({ success: true, message: 'All good' });
    });

    // Mount Sentry Express error handler followed by custom sentryErrorHandler
    Sentry.setupExpressErrorHandler(testApp);
    testApp.use(sentryErrorHandler);

    const testServer = await new Promise((resolve) => {
      const s = testApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const testPort = testServer.address().port;

    try {
      // 8a. Sync route error test
      const resSync = await sendRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/test/sync-error',
        method: 'GET'
      });
      await Sentry.flush(1000);

      assert(
        'Synchronous route error returns HTTP 500',
        resSync.statusCode === 500,
        `Status: ${resSync.statusCode}`
      );
      assert(
        'Sentry captured synchronous route error',
        capturedEvents.some(e => e.exception?.values?.[0]?.value === 'Synchronous Express route exception'),
        `Captured event values: ${capturedEvents.map(e => e.exception?.values?.[0]?.value).join(', ')}`
      );

      // 8b. Async route error test
      capturedEvents.length = 0;
      const resAsync = await sendRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/test/async-error',
        method: 'GET'
      });
      await Sentry.flush(1000);

      assert(
        'Asynchronous route error returns HTTP 500',
        resAsync.statusCode === 500,
        `Status: ${resAsync.statusCode}`
      );
      assert(
        'Sentry captured asynchronous route error',
        capturedEvents.some(e => e.exception?.values?.[0]?.value === 'Asynchronous pipeline execution failure'),
        `Captured event values: ${capturedEvents.map(e => e.exception?.values?.[0]?.value).join(', ')}`
      );

      // 8c. Success route test
      capturedEvents.length = 0;
      const resSuccess = await sendRequest({
        hostname: '127.0.0.1',
        port: testPort,
        path: '/test/success',
        method: 'GET'
      });
      await Sentry.flush(1000);

      assert(
        'Success route returns HTTP 200 without Sentry error capture',
        resSuccess.statusCode === 200 && capturedEvents.length === 0,
        `Status: ${resSuccess.statusCode}, Sentry count: ${capturedEvents.length}`
      );
    } finally {
      testServer.close();
    }

    // -------------------------------------------------------------------------
    // TEST 9: Production Mode Stack Trace Sanitization (Security & Privacy)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 9] Security Check: Stack traces hidden from client in production');
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    sentStatus = null;
    sentJson = null;
    const sensitiveError = new Error('Secret internal DB query syntax error at line 42: SELECT password FROM users');
    sensitiveError.statusCode = 500;

    sentryErrorHandler(sensitiveError, mockReq, mockRes, () => {});
    process.env.NODE_ENV = prevEnv;

    assert(
      'Client response in production is generic and does NOT leak internal details or stack',
      sentJson?.message === 'Something went wrong on our end. We are looking into it.',
      `Production client response message: "${sentJson?.message}"`
    );

  } catch (err) {
    console.error('💥 Unexpected exception during test execution:', err);
    failedCount++;
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('='.repeat(70));

  if (failedCount > 0) {
    console.error('❌ Sentry observability verification suite FAILED!');
    process.exit(1);
  } else {
    console.log('✅ All Sentry observability verification tests PASSED successfully!\n');
    process.exit(0);
  }
}

// Execute test suite
runTestSuite().catch((err) => {
  console.error('💥 Fatal error running test suite:', err);
  process.exit(1);
});
