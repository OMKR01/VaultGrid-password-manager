/**
 * VaultGrid — a minimal local password manager.
 *
 * How the security model works (kept intentionally simple, for a mini project):
 *  - On first run you set a MASTER PASSWORD. We store a bcrypt hash of it
 *    (used only to verify logins) and a random "key salt".
 *  - On every login you type the master password again. We re-derive a 256-bit
 *    encryption key from it with scrypt + the stored key salt. That key lives
 *    ONLY in server memory, attached to your session — it is never written to disk.
 *  - Each saved account password is encrypted individually with AES-256-GCM
 *    using a fresh random IV, before touching the disk. The vault file
 *    (data/vault.json) therefore never contains a single plaintext password.
 *  - Log out / close the server and the key is gone — the file is unreadable
 *    without the master password again.
 *
 * This is a teaching/demo project, not an audited security product.
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// When run standalone (npm start) this defaults to ./data.
// When launched from the Electron desktop app, main.js points this at a
// per-user, writable folder (e.g. %APPDATA%/VaultGrid/data) before requiring
// this file, so the vault survives app updates/reinstalls.
const DATA_DIR = process.env.VAULTGRID_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'vault.json');
const PORT = process.env.PORT || 4300;

// ---------- storage helpers ----------

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { masterHash: null, keySalt: null, entries: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
}

function loadVault() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveVault(vault) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(vault, null, 2));
}

// ---------- crypto helpers ----------

function deriveKey(masterPassword, keySaltHex) {
  return crypto.scryptSync(masterPassword, Buffer.from(keySaltHex, 'hex'), 32);
}

function encrypt(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { enc, iv: iv.toString('hex'), tag };
}

function decrypt(enc, ivHex, tagHex, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let dec = decipher.update(enc, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

// ---------- app setup ----------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'), // new on every server start -> old sessions invalidated, which is fine for a local tool
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 2 } // 2 hours
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated && req.session.encKey) return next();
  return res.status(401).json({ error: 'Not authenticated.' });
}

// ---------- auth routes ----------

app.get('/api/status', (req, res) => {
  const vault = loadVault();
  res.json({
    isSetup: !!vault.masterHash,
    authenticated: !!(req.session && req.session.authenticated)
  });
});

app.post('/api/setup', (req, res) => {
  const { masterPassword } = req.body || {};
  const vault = loadVault();
  if (vault.masterHash) return res.status(400).json({ error: 'Master password already set.' });
  if (!masterPassword || masterPassword.length < 8) {
    return res.status(400).json({ error: 'Master password must be at least 8 characters.' });
  }
  vault.masterHash = bcrypt.hashSync(masterPassword, 10);
  vault.keySalt = crypto.randomBytes(16).toString('hex');
  vault.entries = [];
  saveVault(vault);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { masterPassword } = req.body || {};
  const vault = loadVault();
  if (!vault.masterHash) return res.status(400).json({ error: 'No vault set up yet.' });
  if (!masterPassword || !bcrypt.compareSync(masterPassword, vault.masterHash)) {
    return res.status(401).json({ error: 'Incorrect master password.' });
  }
  const key = deriveKey(masterPassword, vault.keySalt);
  req.session.authenticated = true;
  req.session.encKey = key.toString('hex');
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------- vault entry routes ----------

app.get('/api/passwords', requireAuth, (req, res) => {
  const vault = loadVault();
  const list = vault.entries.map(e => ({
    id: e.id,
    site: e.site,
    username: e.username,
    category: e.category || 'Other',
    notes: e.notes || '',
    updatedAt: e.updatedAt
  }));
  res.json(list);
});

app.get('/api/passwords/:id/reveal', requireAuth, (req, res) => {
  const vault = loadVault();
  const entry = vault.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found.' });
  try {
    const plain = decrypt(entry.enc, entry.iv, entry.tag, req.session.encKey);
    res.json({ password: plain });
  } catch (e) {
    res.status(500).json({ error: 'Could not decrypt entry.' });
  }
});

app.post('/api/passwords', requireAuth, (req, res) => {
  const { site, username, password, category, notes } = req.body || {};
  if (!site || !password) return res.status(400).json({ error: 'Site and password are required.' });
  const vault = loadVault();
  const { enc, iv, tag } = encrypt(password, req.session.encKey);
  const entry = {
    id: crypto.randomUUID(),
    site,
    username: username || '',
    category: category || 'Other',
    notes: notes || '',
    enc, iv, tag,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  vault.entries.unshift(entry);
  saveVault(vault);
  res.json({ ok: true, id: entry.id });
});

app.put('/api/passwords/:id', requireAuth, (req, res) => {
  const vault = loadVault();
  const entry = vault.entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found.' });
  const { site, username, password, category, notes } = req.body || {};
  if (site !== undefined) entry.site = site;
  if (username !== undefined) entry.username = username;
  if (category !== undefined) entry.category = category;
  if (notes !== undefined) entry.notes = notes;
  if (password) {
    const { enc, iv, tag } = encrypt(password, req.session.encKey);
    entry.enc = enc; entry.iv = iv; entry.tag = tag;
  }
  entry.updatedAt = new Date().toISOString();
  saveVault(vault);
  res.json({ ok: true });
});

app.delete('/api/passwords/:id', requireAuth, (req, res) => {
  const vault = loadVault();
  const before = vault.entries.length;
  vault.entries = vault.entries.filter(e => e.id !== req.params.id);
  if (vault.entries.length === before) return res.status(404).json({ error: 'Not found.' });
  saveVault(vault);
  res.json({ ok: true });
});

// Only auto-start the server when this file is run directly (`node server.js`
// / `npm start`). When Electron's main.js requires this module instead, it
// calls start() itself after pointing VAULTGRID_DATA_DIR at the right folder.
function start(port = PORT) {
  // Bind to loopback only (127.0.0.1), never 0.0.0.0 — this is a single-user
  // local tool and should never be reachable from other devices on the network.
  return app.listen(port, '127.0.0.1', () => {
    console.log(`VaultGrid running at http://localhost:${port} (loopback only)`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start, PORT };
