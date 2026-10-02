// One-time backfill: add the "wynch-landing" tag to existing Shopify
// customers so the dashboard (which filters by that tag) also shows people
// who registered before tagging was added.
//
//   GET /api/backfill-tags?key=<DASHBOARD_TOKEN>              → tag ALL untagged customers
//   GET /api/backfill-tags?key=<DASHBOARD_TOKEN>&dry=1        → preview only, no changes
//
// Protected by the dashboard token. Preserves any existing tags. Safe to run
// more than once (already-tagged customers are skipped). Remove this file
// once you've run it.

import { getShopifyAccessToken } from '../lib/shopify.js';

const SHOPIFY_API_VERSION = '2024-01';
const TAG = 'wynch-landing';
const MAX_PAGES = 12; // safety cap (~3000 customers)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.DASHBOARD_TOKEN || '12345678';
  const key = req.query && req.query.key ? String(req.query.key) : '';
  if (key !== token) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = !!(req.query && (req.query.dry === '1' || req.query.dry === 'true'));

  try {
    const shopToken = await getShopifyAccessToken();
    const shop = process.env.SHOPIFY_SHOP;
    const headers = { 'X-Shopify-Access-Token': shopToken, 'Content-Type': 'application/json', Accept: 'application/json' };

    // Collect all customers (cursor pagination).
    let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers.json?limit=250&fields=id,tags,email`;
    const all = [];
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const r = await fetch(url, { headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (page === 0) return res.status(502).json({ error: `Shopify ${r.status}`, detail: JSON.stringify(j).slice(0, 200) });
        break;
      }
      all.push(...(j.customers || []));
      const link = r.headers.get('link') || r.headers.get('Link') || '';
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    }

    const needsTag = all.filter((c) => {
      const tags = String(c.tags || '').split(',').map((t) => t.trim());
      return !tags.includes(TAG);
    });

    if (dryRun) {
      return res.status(200).json({ dryRun: true, total: all.length, wouldTag: needsTag.length });
    }

    let tagged = 0;
    const errors = [];
    for (const c of needsTag) {
      const merged = String(c.tags || '').trim();
      const newTags = merged ? merged + ', ' + TAG : TAG;
      const r = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers/${c.id}.json`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ customer: { id: c.id, tags: newTags } }),
      });
      if (r.ok) tagged++;
      else if (errors.length < 5) errors.push({ id: c.id, status: r.status });
    }

    return res.status(200).json({ total: all.length, alreadyTagged: all.length - needsTag.length, tagged, errors });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
