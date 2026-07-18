// Seeds demo data on first boot so the marketplace never looks empty.
const { db, q, sha256, certCode, scryptHash } = require('./db');

function seedIfEmpty() {
  if (q.userCount.get().n > 0) return;
  console.log('Seeding demo data…');

  const mk = (email, name, title, bio, skills) =>
    q.insertUser.run(email, scryptHash('demo1234'), name, title, bio, skills).lastInsertRowid;

  const elena = mk('elena@demo.checkedby.app', 'Elena Marsh', 'Senior Editor, ex-Reuters', '15 years in newsroom editing. I verify AI-drafted articles, reports and marketing copy against primary sources.', 'editing, fact-checking, journalism');
  const raj = mk('raj@demo.checkedby.app', 'Raj Patel', 'Staff Software Engineer', 'I run, test and security-review AI-generated code before it ships. Python, JS/TS, SQL.', 'code review, security, python, javascript');
  const sofia = mk('sofia@demo.checkedby.app', 'Sofia Lindqvist', 'Compliance Consultant (EU)', 'I help SMEs meet EU AI Act transparency obligations. Former DPO.', 'compliance, EU AI Act, GDPR, policy');
  const acme = mk('owner@brightpath.example', 'Maya Chen', 'Founder, BrightPath Digital', 'Boutique marketing studio. We use AI for drafts — and humans to make them true.', '');

  // Completed job with certificate (showpiece)
  const content1 = `BrightPath Digital — Client Newsletter (July 2026)

Subject: Three changes to EU digital rules your shop needs to know

1. From 2 August 2026, the EU AI Act's transparency obligations apply: AI-generated text published to inform the public must be disclosed as AI-generated — unless it has undergone human review with editorial responsibility.
2. Chatbots must clearly tell users they are talking to a machine at the start of the conversation.
3. Synthetic images, audio and video ("deepfakes") must be visibly labelled.

What this means for you: if we draft your content with AI, we make sure a named human editor reviews and takes responsibility for it — so your brand stays compliant and credible.`;
  const j1 = q.insertJob.run(acme, 'Verify claims in our client newsletter about EU AI rules', 'marketing', content1, sha256(content1), 'Please verify every regulatory claim against the actual EU AI Act text. Flag anything overstated.', 'Claude', 4500).lastInsertRowid;
  q.insertTx.run(acme, -4500, 'escrow', j1, `Escrow for job #${j1}`);
  db.prepare("UPDATE jobs SET status='completed', claimed_by=?, claimed_at=datetime('now','-2 days'), submitted_at=datetime('now','-1 day'), completed_at=datetime('now','-20 hours'), created_at=datetime('now','-3 days') WHERE id=?").run(sofia, j1);
  const checks1 = [
    { label: 'Every factual claim and statistic verified against a real source', passed: true, note: 'Checked against Regulation (EU) 2024/1689, Art. 50.' },
    { label: 'No hallucinated product features, quotes, or endorsements', passed: true, note: '' },
    { label: 'Brand voice and tone reviewed and adjusted where needed', passed: true, note: 'Minor tone edits in item 3.' },
    { label: 'Spot-checked for near-duplicate / templated AI phrasing', passed: true, note: '' },
    { label: 'Claims reviewed for advertising-compliance red flags', passed: true, note: 'Date and scope of Art. 50 correctly stated.' },
  ];
  const r1 = q.insertReview.run(j1, sofia, JSON.stringify(checks1), 'Accurate summary. I tightened the wording on the human-review exemption so it tracks Article 50(4) precisely: the exemption applies where the content has undergone human review or editorial control and a natural or legal person holds editorial responsibility.', '', 'verified_with_edits', 55).lastInsertRowid;
  q.rateReview.run(5, r1);
  q.bumpReviewer.run(5, sofia);
  q.updateBalance.run(3825, sofia);
  q.insertTx.run(sofia, 3825, 'payout', j1, `Payout for job #${j1} (15% platform fee applied)`);
  // Deterministic demo code so every serverless instance seeds the same showpiece certificate
  q.insertCert.run('CB-DEMO-2026', j1, r1);

  // Open jobs
  const content2 = `def dedupe_customers(rows):
    """AI-generated: merge duplicate customer records by fuzzy name+email match."""
    import pandas as pd
    from rapidfuzz import fuzz
    df = pd.DataFrame(rows)
    df['key'] = df['email'].str.lower().str.strip()
    merged = df.groupby('key').first().reset_index()
    for i, a in merged.iterrows():
        for j, b in merged.iterrows():
            if i < j and fuzz.token_sort_ratio(a['name'], b['name']) > 92:
                merged.at[j, 'merge_into'] = a['id']
    return merged`;
  q.insertJob.run(acme, 'Sanity-check AI-written Python dedupe script before we run it on 40k records', 'code', content2, sha256(content2), 'Does this actually work? Worried about the O(n^2) loop and whether rapidfuzz is used correctly.', 'ChatGPT', 6000);
  q.insertTx.run(acme, -6000, 'escrow', 2, 'Escrow for job #2');

  const content3 = `Market brief (AI draft): The global market for verified-human content services is projected to reach $4.7B by 2028, growing at a 31% CAGR. According to a 2026 Gartner report, 50% of organizations will adopt zero-trust data governance by 2028 due to unverified AI-generated data. A Fortune analysis (June 2026) found major publishers including Hachette imposing new controls on AI-generated submissions.`;
  q.insertJob.run(acme, 'Fact-check market stats in investor one-pager', 'report', content3, sha256(content3), 'The $4.7B/31% CAGR figure came from the model — I cannot find the source. Please verify or kill it.', 'Gemini', 3500);
  q.insertTx.run(acme, -3500, 'escrow', 3, 'Escrow for job #3');

  db.prepare('UPDATE users SET balance_cents = ? WHERE id = ?').run(10000 - 4500 - 6000 - 3500 + 20000, acme); // topped-up demo requester
  console.log('Seed complete.');
}

module.exports = { seedIfEmpty };
if (require.main === module) seedIfEmpty();
