import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { waitForDb, pool } from './db.js';
import { migrate } from './seed.js';
import { authenticate } from './auth.js';
import { HttpError } from './util.js';
import { VERSION } from './services/system.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import { customers, suppliers, products, currencies, costCenters } from './routes/masterdata.js';
import documentRoutes from './routes/documents.js';
import payableRoutes from './routes/payables.js';
import accountingRoutes from './routes/accounting.js';
import reportRoutes from './routes/reports.js';
import extraRoutes from './routes/extras.js';
import { startScheduler } from './services/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      frameSrc: ["'self'", 'blob:'],
      objectSrc: ["'self'", 'blob:'],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  // HSTS setzt der Reverse-Proxy, sobald TLS eingerichtet ist.
  strictTransportSecurity: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
}));
// Die Belegablage nimmt grössere Dateien an und bringt ihren eigenen Parser mit.
const json = express.json({ limit: '4mb' });
app.use((req, res, next) => (req.path === '/api/attachments' ? next() : json(req, res, next)));
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', version: VERSION });
  } catch {
    res.status(503).json({ status: 'db-unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api', authenticate);
app.use('/api/customers', customers);
app.use('/api/suppliers', suppliers);
app.use('/api/products', products);
app.use('/api/currencies', currencies);
app.use('/api/cost-centers', costCenters);
app.use('/api/documents', documentRoutes);
app.use('/api/payables', payableRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api', extraRoutes);
app.use('/api', adminRoutes);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unbekannter API-Endpunkt')));

// ---------- Frontend (gebaute SPA) ----------
const publicDir = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(publicDir, 'index.html')));
}

// ---------- Fehlerbehandlung ----------
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Die übermittelten Daten sind zu gross.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültige Anfrage.' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ein Eintrag mit dieser Nummer/Bezeichnung existiert bereits.' });
  if (err.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'Der Eintrag wird noch verwendet und kann nicht gelöscht werden. Deaktivieren Sie ihn stattdessen.' });
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'Ein verknüpfter Eintrag existiert nicht.' });
  if (err.code === 'ER_DATA_TOO_LONG' || err.code === 'WARN_DATA_TRUNCATED' || err.code === 'ER_TRUNCATED_WRONG_VALUE') {
    return res.status(400).json({ error: 'Ein Feld enthält einen ungültigen oder zu langen Wert.' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Interner Serverfehler. Details stehen im Serverprotokoll.' });
});

const port = Number(process.env.PORT || 3000);
await waitForDb();
await migrate();
const host = process.env.HOST || '0.0.0.0';
startScheduler();
app.listen(port, host, () => console.log(`[server] StrawberryERP läuft auf ${host}:${port}`));
