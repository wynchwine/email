// Dashboard data endpoint. Protected by a shared token (DASHBOARD_TOKEN).
// Returns Shopify customer count + recent customers, and the Klaviyo list
// subscriber count. Never returns anything unless the token matches.
//
//   GET /api/stats?key=<DASHBOARD_TOKEN>
//
// Set DASHBOARD_TOKEN in Vercel (any long random string). Keep it private —
// it grants access to customer emails/names.

import { getShopifyAccessToken } from '../lib/shopify.js';

const SHOPIFY_API_VERSION = '2024-01';
const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Temporary default so the dashboard works before DASHBOARD_TOKEN is set in
  // Vercel. CHANGE THIS: set a strong DASHBOARD_TOKEN env var — it overrides
  // the default. The default only guards customer PII with a weak password.
  const token = process.env.DASHBOARD_TOKEN || '12345678';
  const key = req.query && req.query.key ? String(req.query.key) : '';
  if (key !== token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const out = { shopify: null, klaviyo: null };

  // Debug mode: ?all=1 lists ALL customers (no tag filter) with their tags,
  // to diagnose why someone is/ isn't showing up.
  const showAll = !!(req.query && (req.query.all === '1' || req.query.all === 'true'));

  // ---- Shopify: only customers created via our landing (tag "wynch-landing") ----
  try {
    const shopToken = await getShopifyAccessToken();
    const shop = process.env.SHOPIFY_SHOP;
    const headers = { 'X-Shopify-Access-Token': shopToken, Accept: 'application/json' };

    // Either the tag search (default) or all customers (debug).
    let url = showAll
      ? `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers.json?limit=250&fields=id,first_name,last_name,email,created_at,tags,email_marketing_consent`
      : `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers/search.json?query=${encodeURIComponent('tag:wynch-landing')}&limit=250`;
    const raw = [];
    let firstStatus = 0;
    let firstBody = '';
    for (let page = 0; page < 8 && url; page++) {
      const r = await fetch(url, { headers });
      if (page === 0) firstStatus = r.status;
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (page === 0) firstBody = JSON.stringify(j).slice(0, 200); break; }
      raw.push(...(j.customers || []));
      const link = r.headers.get('link') || r.headers.get('Link') || '';
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    }

    if (firstStatus && firstStatus >= 400) {
      out.shopify = { error: `Shopify ${firstStatus}`, detail: firstBody };
    } else {
      const customers = raw
        .map((c) => ({
          name: [c.first_name, c.last_name].filter(Boolean).join(' '),
          email: c.email,
          created_at: c.created_at,
          marketing: !!(c.email_marketing_consent && c.email_marketing_consent.state === 'subscribed'),
          ...(showAll ? { tags: c.tags || '' } : {}),
        }))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      out.shopify = { count: customers.length, customers: customers.slice(0, 200), mode: showAll ? 'all' : 'tagged' };
    }
  } catch (e) {
    out.shopify = { error: String(e && e.message ? e.message : e) };
  }

  // ---- Klaviyo: newsletter list subscriber count ----
  try {
    const kkey = process.env.KLAVIYO_API_KEY;
    const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;
    if (kkey && listId) {
      const r = await fetch(
        `${KLAVIYO_BASE}/lists/${listId}/?additional-fields[list]=profile_count`,
        { headers: { Authorization: `Klaviyo-API-Key ${kkey}`, revision: KLAVIYO_REVISION, Accept: 'application/json' } }
      );
      const b = await r.json().catch(() => ({}));
      const a = (b && b.data && b.data.attributes) || {};
      out.klaviyo = { listName: a.name || null, subscribers: (typeof a.profile_count === 'number' ? a.profile_count : null) };
    }
  } catch (e) {
    out.klaviyo = { error: String(e && e.message ? e.message : e) };
  }

  return res.status(200).json(out);
}
