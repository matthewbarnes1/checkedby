// CheckedBy — database layer (built-in node:sqlite, zero native deps)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/checkedby-data' : path.join(__dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'checkedby.db'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  balance_cents INTEGER NOT NULL DEFAULT 10000,
  reviews_done INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  instructions TEXT DEFAULT '',
  ai_tool TEXT DEFAULT '',
  bounty_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open|claimed|submitted|completed|cancelled
  claimed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  submitted_at TEXT,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  checklist_json TEXT NOT NULL,
  comments TEXT DEFAULT '',
  edited_content TEXT DEFAULT '',
  verdict TEXT NOT NULL, -- verified|verified_with_edits|rejected
  minutes_spent INTEGER DEFAULT 0,
  rating INTEGER, -- requester's rating of the review, 1..5
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  review_id INTEGER NOT NULL REFERENCES reviews(id),
  issued_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL, -- positive = credit, negative = debit
  kind TEXT NOT NULL, -- signup_credit|escrow|payout|refund
  job_id INTEGER,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- category checklists ----------
const CATEGORIES = {
  marketing: {
    label: 'Marketing & copy',
    checks: [
      'Every factual claim and statistic verified against a real source',
      'No hallucinated product features, quotes, or endorsements',
      'Brand voice and tone reviewed and adjusted where needed',
      'Spot-checked for near-duplicate / templated AI phrasing',
      'Claims reviewed for advertising-compliance red flags',
    ],
  },
  report: {
    label: 'Reports & research',
    checks: [
      'All citations exist and actually support the claims made',
      'Key figures recomputed or traced to primary data',
      'Hallucination sweep: names, dates, events, quotes verified',
      'Logic and structure reviewed for unsupported leaps',
      'Data recency checked against the stated time frame',
    ],
  },
  code: {
    label: 'Code & technical',
    checks: [
      'Code executed / built successfully by the reviewer',
      'No hallucinated APIs, packages, or config options',
      'Security review: injection, auth, secrets, unsafe defaults',
      'Edge cases and error handling inspected',
      'Dependencies and licenses sanity-checked',
    ],
  },
  legal: {
    label: 'Legal & policy drafts',
    checks: [
      'Cited statutes, cases, and regulations verified to exist',
      'Jurisdiction and applicability sanity-checked',
      'Risky, ambiguous, or unenforceable clauses flagged',
      'Terminology checked for accuracy and consistency',
      'Clearly flagged as requiring qualified counsel before use',
    ],
  },
  translation: {
    label: 'Translation & localization',
    checks: [
      'Meaning preserved — no mistranslated or dropped content',
      'Idioms and cultural references localized appropriately',
      'Domain terminology verified against glossaries',
      'Names, numbers, dates, and units checked',
      'Formatting and register appropriate for the audience',
    ],
  },
  other: {
    label: 'General content',
    checks: [
      'Factual accuracy verified where checkable',
      'Hallucination sweep for invented specifics',
      'Coherence and internal consistency reviewed',
      'Tone appropriate for stated purpose',
      'Obvious omissions or errors flagged',
    ],
  },
};

const VERDICTS = {
  verified: 'Verified — accurate as delivered',
  verified_with_edits: 'Verified with edits — accurate after reviewer corrections',
  rejected: 'Not verifiable — significant problems found',
};

const PLATFORM_FEE = 0.15; // 15%

// ---------- helpers ----------
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function certCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return `CB-${s.slice(0, 4)}-${s.slice(4)}`;
}

function scryptHash(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

// ---------- queries ----------
const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertUser: db.prepare('INSERT INTO users (email, pass_hash, name, title, bio, skills) VALUES (?,?,?,?,?,?)'),
  updateBalance: db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?'),
  insertTx: db.prepare('INSERT INTO transactions (user_id, amount_cents, kind, job_id, note) VALUES (?,?,?,?,?)'),
  txForUser: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50'),

  insertJob: db.prepare('INSERT INTO jobs (requester_id, title, category, content_text, content_hash, instructions, ai_tool, bounty_cents) VALUES (?,?,?,?,?,?,?,?)'),
  jobById: db.prepare('SELECT * FROM jobs WHERE id = ?'),
  openJobs: db.prepare("SELECT j.*, u.name AS requester_name FROM jobs j JOIN users u ON u.id = j.requester_id WHERE j.status = 'open' ORDER BY j.id DESC"),
  jobsByRequester: db.prepare('SELECT * FROM jobs WHERE requester_id = ? ORDER BY id DESC'),
  jobsByReviewer: db.prepare('SELECT * FROM jobs WHERE claimed_by = ? ORDER BY id DESC'),
  claimJob: db.prepare("UPDATE jobs SET status='claimed', claimed_by = ?, claimed_at = datetime('now') WHERE id = ? AND status = 'open'"),
  submitJob: db.prepare("UPDATE jobs SET status='submitted', submitted_at = datetime('now') WHERE id = ? AND status = 'claimed'"),
  completeJob: db.prepare("UPDATE jobs SET status='completed', completed_at = datetime('now') WHERE id = ? AND status = 'submitted'"),

  insertReview: db.prepare('INSERT INTO reviews (job_id, reviewer_id, checklist_json, comments, edited_content, verdict, minutes_spent) VALUES (?,?,?,?,?,?,?)'),
  reviewByJob: db.prepare('SELECT r.*, u.name AS reviewer_name, u.title AS reviewer_title FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.job_id = ?'),
  rateReview: db.prepare('UPDATE reviews SET rating = ? WHERE id = ?'),
  bumpReviewer: db.prepare('UPDATE users SET reviews_done = reviews_done + 1, rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?'),

  insertCert: db.prepare('INSERT INTO certificates (code, job_id, review_id) VALUES (?,?,?)'),
  certByCode: db.prepare('SELECT * FROM certificates WHERE code = ?'),
  certByJob: db.prepare('SELECT * FROM certificates WHERE job_id = ?'),
  certCount: db.prepare('SELECT COUNT(*) AS n FROM certificates'),
  userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
  jobCount: db.prepare('SELECT COUNT(*) AS n FROM jobs'),

  reviewerProfileReviews: db.prepare(`SELECT r.verdict, r.created_at, r.rating, j.title, j.category, c.code
    FROM reviews r JOIN jobs j ON j.id = r.job_id LEFT JOIN certificates c ON c.review_id = r.id
    WHERE r.reviewer_id = ? ORDER BY r.id DESC LIMIT 20`),
};

module.exports = { db, q, CATEGORIES, VERDICTS, PLATFORM_FEE, sha256, certCode, scryptHash, verifyPassword };
