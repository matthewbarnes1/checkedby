// CheckedBy — main application server
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { q, CATEGORIES, VERDICTS, PLATFORM_FEE, sha256, certCode, scryptHash, verifyPassword } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- tiny signed-cookie sessions ----------
function sign(val) {
  return crypto.createHmac('sha256', SECRET).update(val).digest('base64url');
}
function setSession(res, userId) {
  const payload = `${userId}.${Date.now()}`;
  res.setHeader('Set-Cookie', `cb_session=${payload}.${sign(payload)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'cb_session=; HttpOnly; Path=/; Max-Age=0');
}
app.use((req, res, next) => {
  req.user = null;
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('cb_session='));
  if (raw) {
    const val = raw.slice('cb_session='.length);
    const i = val.lastIndexOf('.');
    if (i > 0) {
      const payload = val.slice(0, i), sig = val.slice(i + 1);
      if (sig && sig === sign(payload)) {
        const user = q.userById.get(Number(payload.split('.')[0]));
        if (user) req.user = user;
      }
    }
  }
  res.locals.user = req.user;
  res.locals.fmtMoney = (c) => `$${(c / 100).toFixed(2)}`;
  res.locals.baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.locals.CATEGORIES = CATEGORIES;
  res.locals.VERDICTS = VERDICTS;
  next();
});
function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

// ---------- marketing ----------
app.get('/', (req, res) => {
  const stats = {
    certs: q.certCount.get().n,
    experts: q.userCount.get().n,
    jobs: q.jobCount.get().n,
  };
  res.render('landing', { stats, page: 'home' });
});

// ---------- auth ----------
app.get('/signup', (req, res) => res.render('auth', { mode: 'signup', error: null, next: req.query.next || '/dashboard', page: 'auth' }));
app.get('/login', (req, res) => res.render('auth', { mode: 'login', error: null, next: req.query.next || '/dashboard', page: 'auth' }));

app.post('/signup', (req, res) => {
  const { email, password, name, title } = req.body;
  const nxt = req.body.next || '/dashboard';
  if (!email || !password || !name || password.length < 8) {
    return res.render('auth', { mode: 'signup', error: 'All fields required; password must be 8+ characters.', next: nxt, page: 'auth' });
  }
  if (q.userByEmail.get(email.toLowerCase().trim())) {
    return res.render('auth', { mode: 'signup', error: 'An account with that email already exists.', next: nxt, page: 'auth' });
  }
  const info = q.insertUser.run(email.toLowerCase().trim(), scryptHash(password), name.trim().slice(0, 80), (title || '').trim().slice(0, 120), '', '');
  q.insertTx.run(info.lastInsertRowid, 10000, 'signup_credit', null, 'Welcome credit (demo)');
  setSession(res, info.lastInsertRowid);
  res.redirect(nxt);
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const nxt = req.body.next || '/dashboard';
  const user = email ? q.userByEmail.get(email.toLowerCase().trim()) : null;
  if (!user || !verifyPassword(password || '', user.pass_hash)) {
    return res.render('auth', { mode: 'login', error: 'Invalid email or password.', next: nxt, page: 'auth' });
  }
  setSession(res, user.id);
  res.redirect(nxt);
});

app.post('/logout', (req, res) => { clearSession(res); res.redirect('/'); });

// ---------- dashboard ----------
app.get('/dashboard', requireAuth, (req, res) => {
  const myJobs = q.jobsByRequester.all(req.user.id);
  const myReviews = q.jobsByReviewer.all(req.user.id);
  const txs = q.txForUser.all(req.user.id);
  res.render('dashboard', { myJobs, myReviews, txs, page: 'dashboard' });
});

// ---------- jobs ----------
app.get('/jobs', (req, res) => {
  let jobs = q.openJobs.all();
  const cat = req.query.category;
  if (cat && CATEGORIES[cat]) jobs = jobs.filter(j => j.category === cat);
  res.render('jobs', { jobs, activeCat: cat || '', page: 'jobs' });
});

app.get('/jobs/new', requireAuth, (req, res) => res.render('job_new', { error: null, page: 'post' }));

app.post('/jobs/new', requireAuth, (req, res) => {
  const { title, category, content_text, instructions, ai_tool, bounty } = req.body;
  const bountyCents = Math.round(parseFloat(bounty || '0') * 100);
  if (!title || !CATEGORIES[category] || !content_text || content_text.length < 40) {
    return res.render('job_new', { error: 'Title, category, and at least 40 characters of content are required.', page: 'post' });
  }
  if (!(bountyCents >= 500 && bountyCents <= 50000)) {
    return res.render('job_new', { error: 'Bounty must be between $5.00 and $500.00.', page: 'post' });
  }
  if (req.user.balance_cents < bountyCents) {
    return res.render('job_new', { error: `Insufficient balance (${(req.user.balance_cents / 100).toFixed(2)} available). Demo accounts start with $100.`, page: 'post' });
  }
  const hash = sha256(content_text);
  const info = q.insertJob.run(req.user.id, title.trim().slice(0, 140), category, content_text.slice(0, 100000), hash, (instructions || '').slice(0, 2000), (ai_tool || '').slice(0, 80), bountyCents);
  q.updateBalance.run(-bountyCents, req.user.id);
  q.insertTx.run(req.user.id, -bountyCents, 'escrow', info.lastInsertRowid, `Escrow for job #${info.lastInsertRowid}`);
  res.redirect(`/jobs/${info.lastInsertRowid}`);
});

app.get('/jobs/:id', (req, res) => {
  const job = q.jobById.get(Number(req.params.id));
  if (!job) return res.status(404).render('notfound', { page: '' });
  const requester = q.userById.get(job.requester_id);
  const reviewer = job.claimed_by ? q.userById.get(job.claimed_by) : null;
  const review = q.reviewByJob.get(job.id) || null;
  const cert = q.certByJob.get(job.id) || null;
  const checklist = review ? JSON.parse(review.checklist_json) : null;
  res.render('job_detail', { job, requester, reviewer, review, cert, checklist, error: req.query.error, page: 'jobs' });
});

app.post('/jobs/:id/claim', requireAuth, (req, res) => {
  const job = q.jobById.get(Number(req.params.id));
  if (!job || job.status !== 'open') return res.redirect(`/jobs/${req.params.id}`);
  if (job.requester_id === req.user.id) return res.redirect(`/jobs/${job.id}`); // can't review your own work
  q.claimJob.run(req.user.id, job.id);
  res.redirect(`/jobs/${job.id}`);
});

app.post('/jobs/:id/review', requireAuth, (req, res) => {
  const job = q.jobById.get(Number(req.params.id));
  if (!job || job.status !== 'claimed' || job.claimed_by !== req.user.id) return res.redirect(`/jobs/${req.params.id}`);
  const { verdict, comments, edited_content, minutes_spent } = req.body;
  if (!VERDICTS[verdict]) return res.redirect(`/jobs/${job.id}`);
  const checks = CATEGORIES[job.category].checks.map((label, i) => ({
    label,
    passed: req.body[`check_${i}`] === 'on',
    note: (req.body[`note_${i}`] || '').slice(0, 500),
  }));
  if (verdict !== 'rejected' && !checks.every(c => c.passed)) {
    // a verified verdict requires every check to pass
    return res.redirect(`/jobs/${job.id}?error=checks`);
  }
  q.insertReview.run(job.id, req.user.id, JSON.stringify(checks), (comments || '').slice(0, 5000), (edited_content || '').slice(0, 100000), verdict, Math.min(Number(minutes_spent) || 0, 6000));
  q.submitJob.run(job.id);
  res.redirect(`/jobs/${job.id}`);
});

app.post('/jobs/:id/accept', requireAuth, (req, res) => {
  const job = q.jobById.get(Number(req.params.id));
  if (!job || job.status !== 'submitted' || job.requester_id !== req.user.id) return res.redirect(`/jobs/${req.params.id}`);
  const review = q.reviewByJob.get(job.id);
  const rating = Math.min(Math.max(Number(req.body.rating) || 5, 1), 5);
  const payout = Math.round(job.bounty_cents * (1 - PLATFORM_FEE));
  q.completeJob.run(job.id);
  q.updateBalance.run(payout, review.reviewer_id);
  q.insertTx.run(review.reviewer_id, payout, 'payout', job.id, `Payout for job #${job.id} (15% platform fee applied)`);
  q.rateReview.run(rating, review.id);
  q.bumpReviewer.run(rating, review.reviewer_id);
  let code = null;
  if (review.verdict !== 'rejected') {
    code = certCode();
    q.insertCert.run(code, job.id, review.id);
  }
  res.redirect(code ? `/cert/${code}` : `/jobs/${job.id}`);
});

// ---------- certificates ----------
function loadCert(code) {
  const cert = q.certByCode.get(code);
  if (!cert) return null;
  const job = q.jobById.get(cert.job_id);
  const review = q.reviewByJob.get(cert.job_id);
  return { cert, job, review, checklist: JSON.parse(review.checklist_json) };
}

app.get('/cert/:code', (req, res) => {
  const data = loadCert(req.params.code.toUpperCase());
  if (!data) return res.status(404).render('notfound', { page: '' });
  res.render('cert', { ...data, page: 'verify' });
});

app.get('/badge/:code.svg', (req, res) => {
  const data = loadCert(req.params.code.toUpperCase());
  res.type('image/svg+xml');
  if (!data) return res.status(404).send('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const label = data.review.verdict === 'verified_with_edits' ? 'Human-verified (edited)' : 'Human-verified';
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="210" height="36" role="img" aria-label="${label}">
  <rect width="210" height="36" rx="7" fill="#0d1b2a"/>
  <circle cx="19" cy="18" r="9" fill="#2dd4a7"/>
  <path d="M14.5 18.2l3 3 5-6" stroke="#0d1b2a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="36" y="16" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="11.5" font-weight="700" fill="#ffffff">${label}</text>
  <text x="36" y="29" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="10" fill="#9fb3c8">checkedby · ${data.cert.code}</text>
</svg>`);
});

app.get('/verify', (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  let result = null, searched = false;
  if (code) { searched = true; result = q.certByCode.get(code) ? code : null; }
  res.render('verify', { searched, result, code, page: 'verify' });
});

// ---------- profiles ----------
app.get('/u/:id', (req, res) => {
  const person = q.userById.get(Number(req.params.id));
  if (!person) return res.status(404).render('notfound', { page: '' });
  const history = q.reviewerProfileReviews.all(person.id);
  res.render('profile', { person, history, page: '' });
});

app.use((req, res) => res.status(404).render('notfound', { page: '' }));

if (require.main === module) {
  require('./seed').seedIfEmpty();
  app.listen(PORT, () => console.log(`CheckedBy running on http://localhost:${PORT}`));
}
module.exports = app;
