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

  // ---- Shopify: total count + most recent customers ----
  try {
    const shopToken = await getShopifyAccessToken();
    const shop = process.env.SHOPIFY_SHOP;
    const headers = { 'X-Shopify-Access-Token': shopToken, Accept: 'application/json' };

    const countRes = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers/count.json`,
      { headers }
    );
    const countJson = await countRes.json().catch(() => ({}));

    const listRes = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers.json` +
      `?limit=100&fields=id,first_name,last_name,email,created_at,email_marketing_consent`,
      { headers }
    );
    const listJson = await listRes.json().catch(() => ({}));

    if (!listRes.ok) {
      out.shopify = { error: `Shopify ${listRes.status}`, detail: JSON.stringify(listJson).slice(0, 200) };
    } else {
      const customers = (listJson.customers || [])
        .map((c) => ({
          name: [c.first_name, c.last_name].filter(Boolean).join(' '),
          email: c.email,
          created_at: c.created_at,
          marketing: !!(c.email_marketing_consent && c.email_marketing_consent.state === 'subscribed'),
        }))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      out.shopify = { count: (typeof countJson.count === 'number' ? countJson.count : customers.length), customers };
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
