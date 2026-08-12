// Dashboard data endpoint (Klaviyo-based). Protected by DASHBOARD_TOKEN.
//
//   GET /api/stats?key=<DASHBOARD_TOKEN>
//
// Registrations = Klaviyo profiles created via our landing (properties.source
// == "landing_signup"). Subscribers = confirmed members of the Club list.

import { getShopifyAccessToken } from '../lib/shopify.js';

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';
const SHOPIFY_API_VERSION = '2024-01';
const SOURCE = 'landing_signup';
// false = count ALL Klaviyo profiles as registrations; true = only landing signups.
const LANDING_ONLY = true;
const MAX_PAGES = 8; // up to 800 profiles
// Hide test registrations from before this date (UTC). Set to '' to show all.
const CUTOFF = '2026-07-27T00:00:00Z';
// Hide specific test emails / whole test domains from the dashboard (display only).
const EXCLUDE_EMAILS = new Set([
  'erica2@gmail.com',
  'igorigor123@mail.com',
  'lol@mail.com',
  'winespeter@mail.com',
  'landingwynch2@atomicmail.io',
].map((e) => e.toLowerCase()));
const EXCLUDE_DOMAINS = ['wynchtest.dev']; // automated CC test accounts

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.DASHBOARD_TOKEN || '12345678';
  const key = req.query && req.query.key ? String(req.query.key) : '';
  if (key !== token) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.KLAVIYO_API_KEY;
  const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;
  if (!apiKey) return res.status(200).json({ error: 'KLAVIYO_API_KEY is not set in Vercel.' });

  const headers = { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: KLAVIYO_REVISION, Accept: 'application/json' };
  const out = { registrations: null, subscribers: null };

  // ---- Subscribers: confirmed members of the Club list ----
  if (listId) {
    try {
      const r = await fetch(`${KLAVIYO_BASE}/lists/${listId}/?additional-fields[list]=profile_count`, { headers });
      const b = await r.json().catch(() => ({}));
      const a = (b && b.data && b.data.attributes) || {};
      out.subscribers = { listName: a.name || 'Club', count: (typeof a.profile_count === 'number' ? a.profile_count : null) };
    } catch (e) {
      out.subscribers = { error: String(e && e.message ? e.message : e) };
    }
  }

  // ---- Registrations: profiles created via our landing ----
  try {
    let url = `${KLAVIYO_BASE}/profiles/?page[size]=100&sort=-created&additional-fields[profile]=subscriptions`;
    const raw = [];
    let firstStatus = 0;
    let firstBody = '';
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const r = await fetch(url, { headers });
      if (page === 0) firstStatus = r.status;
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { if (page === 0) firstBody = JSON.stringify(b).slice(0, 200); break; }
      raw.push(...(b.data || []));
      url = b.links && b.links.next ? b.links.next : null;
    }

    if (firstStatus >= 400) {
      out.registrations = { error: `Klaviyo ${firstStatus}`, detail: firstBody };
    } else {
      const profiles = raw
        .filter((p) => {
          const a = p.attributes || {};
          if (LANDING_ONLY) {
            const props = a.properties;
            if (!props || props.source !== SOURCE) return false;
          }
          if (CUTOFF && a.created && a.created < CUTOFF) return false; // hide pre-cutoff test data
          const email = String(a.email || '').toLowerCase();
          if (EXCLUDE_EMAILS.has(email)) return false;
          if (EXCLUDE_DOMAINS.some((d) => email.endsWith('@' + d))) return false;
          return true;
        })
        .map((p) => {
          const a = p.attributes || {};
          const props = a.properties || {};
          const consent = a.subscriptions && a.subscriptions.email && a.subscriptions.email.marketing && a.subscriptions.email.marketing.consent;
          return {
            name: [a.first_name, a.last_name].filter(Boolean).join(' '),
            email: a.email,
            created_at: a.created,
            marketing: consent === 'SUBSCRIBED',
            utm_source: props.utm_source || '',
          };
        });
      // Enrich with Shopify purchase data (orders count + total spent),
      // matched by email. Best-effort: if Shopify is unreachable, leave blank.
      try {
        const map = await shopifyPurchaseMap();
        if (map) {
          profiles.forEach((p) => {
            const m = map[String(p.email || '').toLowerCase()];
            if (m) { p.orders = m.orders; p.spent = m.spent; }
          });
          out.purchases = true;
        }
      } catch (e) {
        // ignore — purchase columns just stay empty
      }

      out.registrations = { count: profiles.length, profiles: profiles.slice(0, 200) };
    }
  } catch (e) {
    out.registrations = { error: String(e && e.message ? e.message : e) };
  }

  return res.status(200).json(out);
}

// Map of lowercased email -> { orders, spent } from Shopify customers.
async function shopifyPurchaseMap() {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) return null;
  const token = await getShopifyAccessToken();
  const headers = { 'X-Shopify-Access-Token': token, Accept: 'application/json' };
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers.json?limit=250&fields=email,orders_count,total_spent`;
  const map = {};
  for (let page = 0; page < 8 && url; page++) {
    const r = await fetch(url, { headers });
    if (!r.ok) { if (page === 0) throw new Error(`Shopify ${r.status}`); break; }
    const j = await r.json().catch(() => ({}));
    (j.customers || []).forEach((c) => {
      if (c.email) map[c.email.toLowerCase()] = { orders: c.orders_count || 0, spent: c.total_spent || '0.00' };
    });
    const link = r.headers.get('link') || r.headers.get('Link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return map;
}
