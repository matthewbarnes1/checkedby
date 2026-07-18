// End-to-end smoke test: exercises the full marketplace loop over HTTP.
const BASE = process.env.BASE || 'http://localhost:3000';
let cookieA = '', cookieB = '';

function jar(res, which) {
  const c = res.headers.get('set-cookie');
  if (c) { const v = c.split(';')[0]; if (which === 'A') cookieA = v; else cookieB = v; }
}
async function req(method, path, { body, who } = {}) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (who === 'A' && cookieA) headers.Cookie = cookieA;
  if (who === 'B' && cookieB) headers.Cookie = cookieB;
  const res = await fetch(BASE + path, { method, headers, body: body ? new URLSearchParams(body).toString() : undefined, redirect: 'manual' });
  jar(res, who);
  return res;
}
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('ok –', msg); };

(async () => {
  let r = await req('GET', '/');
  assert(r.status === 200 && (await r.text()).includes('Real humans'), 'landing page renders');

  r = await req('GET', '/jobs');
  assert(r.status === 200 && (await r.text()).includes('dedupe'), 'marketplace lists seeded open jobs');

  // A = business, B = reviewer
  const suffix = Math.floor(Math.random() * 1e9);
  r = await req('POST', '/signup', { who: 'A', body: { email: `biz${suffix}@t.com`, password: 'password123', name: 'Biz Owner', title: 'Founder', next: '/dashboard' } });
  assert(r.status === 302 && cookieA, 'business signup sets session');
  r = await req('POST', '/signup', { who: 'B', body: { email: `rev${suffix}@t.com`, password: 'password123', name: 'Expert Reviewer', title: 'Senior Analyst', next: '/dashboard' } });
  assert(r.status === 302 && cookieB, 'reviewer signup sets session');

  r = await req('POST', '/jobs/new', { who: 'A', body: { title: 'Smoke test job', category: 'report', content_text: 'This AI-generated market summary claims revenue grew 40% in 2025 based on internal data and cites three analyst reports.', instructions: 'Check the 40% figure.', ai_tool: 'TestGPT', bounty: '20' } });
  assert(r.status === 302, 'job posted');
  const jobUrl = r.headers.get('location');
  const jobId = jobUrl.split('/').pop();

  r = await req('GET', '/dashboard', { who: 'A' });
  let html = await r.text();
  assert(html.includes('$80.00'), 'escrow deducted from business balance ($100 → $80)');

  r = await req('POST', `/jobs/${jobId}/claim`, { who: 'B' });
  r = await req('GET', `/jobs/${jobId}`, { who: 'B' });
  html = await r.text();
  assert(html.includes('Your review'), 'reviewer claimed job and sees review form');

  // Verified verdict with an unchecked box must be rejected
  r = await req('POST', `/jobs/${jobId}/review`, { who: 'B', body: { verdict: 'verified', comments: 'x', minutes_spent: '5', check_0: 'on' } });
  r = await req('GET', `/jobs/${jobId}`, { who: 'B' });
  assert((await r.text()).includes('Your review'), 'incomplete checklist blocks verified verdict');

  const checks = { check_0: 'on', check_1: 'on', check_2: 'on', check_3: 'on', check_4: 'on', note_0: 'Traced to source.' };
  r = await req('POST', `/jobs/${jobId}/review`, { who: 'B', body: { ...checks, verdict: 'verified_with_edits', comments: 'Corrected the growth figure to 34%.', edited_content: 'Revenue grew 34% in 2025.', minutes_spent: '25' } });
  assert(r.status === 302, 'review submitted');

  r = await req('POST', `/jobs/${jobId}/accept`, { who: 'A', body: { rating: '5' } });
  assert(r.status === 302 && r.headers.get('location').startsWith('/cert/'), 'acceptance issues certificate');
  const certCode = r.headers.get('location').split('/').pop();

  r = await req('GET', `/cert/${certCode}`);
  html = await r.text();
  assert(r.status === 200 && html.includes('Certificate of Human Verification') && html.includes('Expert Reviewer'), 'public certificate page renders with reviewer sign-off');

  r = await req('GET', `/badge/${certCode}.svg`);
  assert(r.status === 200 && (await r.text()).includes('Human-verified'), 'embeddable badge SVG served');

  r = await req('GET', `/verify?code=${certCode}`);
  assert((await r.text()).includes('Valid certificate'), 'verify endpoint confirms certificate');
  r = await req('GET', '/verify?code=CB-FAKE-CODE');
  assert((await r.text()).includes('No certificate found'), 'verify endpoint rejects unknown code');

  r = await req('GET', '/dashboard', { who: 'B' });
  html = await r.text();
  assert(html.includes('$117.00'), 'reviewer paid out 85% of $20 ($100 → $117)');

  console.log('\nALL SMOKE TESTS PASSED');
  process.exit(0);
})().catch(e => { console.error('FAIL (exception):', e.message); process.exit(1); });
