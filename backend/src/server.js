require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const https = require('https');
const pool = require('./db/connection');
const { initializeDatabase } = require('./db/init');
const EmailService = require('./services/emailService');

// Routes
const authRoutes = require('./routes/auth');
const applicationRoutes = require('./routes/applications');
const verifyRoutes = require('./routes/verify');
const adminRoutes = require('./routes/admin');
const certificateRoutes = require('./routes/certificates');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────
const allowedOrigins = new Set([
  'https://certicheck-psi.vercel.app',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5500',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
  'file://',
  ...String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
]);
app.use(cors({
  origin: function(origin, cb) {
    // allow local development origins and GitHub Codespaces port-forwarded domains
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    if (/^https:\/\/[a-zA-Z0-9-]+\.(app\.github\.dev|githubpreview\.dev)(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// ── HEALTH CHECK ───────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const email = EmailService.getReadiness();
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      timestamp: result.rows[0].now,
      message: 'Certicheck backend is running',
      email
    });
  } catch (err) {
    res.status(200).json({
      status: 'degraded',
      message: 'Backend is running, but the database is unavailable',
      error: err.message,
      email
    });
  }
});

function callSolanaRpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const request = https.request({
      hostname: 'api.mainnet-beta.solana.com',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (response.statusCode >= 400 || parsed.error) {
            reject(new Error(parsed.error?.message || 'Solana RPC request failed'));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });

    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

app.get('/api/network/tps', async (req, res) => {
  try {
    const rpcResponse = await callSolanaRpc('getRecentPerformanceSamples', [10]);
    const samples = rpcResponse.result || [];
    const values = samples.map(sample => {
      const txCount = Number(sample.numTransactions || 0);
      const seconds = Number(sample.samplePeriodSecs || 1);
      return Math.max(0, Math.round(txCount / seconds));
    });

    const currentTps = values[0] || 0;
    const peakTps = values.length ? Math.max(...values) : 0;
    const averageTps = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

    res.json({
      success: true,
      samples: values,
      currentTps,
      peakTps,
      averageTps,
      updatedAt: new Date().toISOString(),
      meta: {
        cluster: 'mainnet-beta',
        sampleCount: values.length,
        samplePeriodSecs: samples[0]?.samplePeriodSecs || 60
      }
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message || 'Unable to fetch Solana TPS data' });
  }
});

// ── ROUTES ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/certificates', certificateRoutes);

const frontendRoot = path.resolve(__dirname, '..', '..');

app.get(['/', '/index', '/index.html'], (req, res) => {
  res.sendFile(path.join(frontendRoot, 'index.html'));
});

app.get(['/admin', '/admin/', '/admin.html'], (req, res) => {
  res.sendFile(path.join(frontendRoot, 'admin.html'));
});

app.use(express.static(frontendRoot, { index: false, redirect: false }));

app.get(/^\/(?!api|health|admin(?:\/?|\.html)?$).*/, (req, res, next) => {
  if (req.path === '/health') return next();
  const requestedFile = path.join(frontendRoot, req.path.replace(/^\//, ''));
  if (requestedFile.endsWith('.html')) {
    return res.sendFile(requestedFile);
  }
  return res.sendFile(path.join(frontendRoot, 'index.html'));
});

// ── 404 HANDLER ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ── ERROR HANDLER ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── START SERVER ───────────────────────────────────────────────────────────
async function startServer() {
  try {
    const isDemo = process.env.DEMO_MODE === 'true';
    // Production safety checks
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.ADMIN_JWT_SECRET) {
        console.error('ADMIN_JWT_SECRET must be set in production environment');
        process.exit(1);
      }
    }

    // Solana on-chain configuration validation
    if (process.env.SOLANA_ENABLE === 'true') {
      if (!process.env.CERTIFICATE_PROGRAM_ID) {
        console.error('SOLANA_ENABLE=true but CERTIFICATE_PROGRAM_ID is not configured. Aborting startup.');
        process.exit(1);
      }
    }
    if (!isDemo) {
      const dbReady = await initializeDatabase();
      if (!dbReady) {
        console.error('PostgreSQL is not reachable. Start the database first: docker compose up -d db');
        process.exit(1);
      }
    } else {
      console.log('✓ Running in DEMO_MODE — skipping database initialization');
    }

    void EmailService.verifyTransporter().catch(error => {
      EmailService.recordDeliveryFailure(error, 'startup verification');
    });

    app.listen(PORT, HOST, () => {
      console.log(`✓ Certicheck backend running on http://${HOST}:${PORT}`);
      console.log(`✓ Health check: http://${HOST}:${PORT}/health`);
    });
  } catch (err) {
    console.error('Failed to start backend:', err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
