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
// (Dashboard shows every profile; filter by creation source via the UI switcher.)
const LANDING_ONLY = false;
const MAX_PAGES = 8; // up to 800 profiles
// Hide test registrations from before this date (UTC). Set to '' to show all.
const CUTOFF = ''; // show all time by default
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
            // Our own "source" property written at signup (falls back to
            // Klaviyo's built-in $source that records how the profile was added).
            klaviyo_source: props.source || props['$source'] || '',
            // UTM captured at registration (stored on the Klaviyo profile).
            reg_utm: regUtmFromProps(props),
            // UTM from the first Shopify order (filled by shopifyFirstOrderMap).
            buy_utm: emptyUtm(),
          };
        });
      const DEBUG = req.query && req.query.debug === '1';
      const dbg = { customers: {}, orders: {} };

      // Enrich with Shopify purchase data (orders count + total spent),
      // matched by email. Best-effort: if Shopify is unreachable, leave blank.
      try {
        const map = await shopifyPurchaseMap();
        if (map) {
          let matched = 0;
          profiles.forEach((p) => {
            const m = map[String(p.email || '').toLowerCase()];
            if (m) {
              matched++;
              p.orders = m.orders;
              p.spent = m.spent;
              // Fall back to the Shopify "utm:<source>" tag for the reg source.
              if (m.utm && !p.reg_utm.source) p.reg_utm.source = m.utm;
            }
          });
          out.purchases = true;
          dbg.customers = { ok: true, fetched: Object.keys(map).length, matched };
        }
      } catch (e) {
        dbg.customers = { ok: false, error: String(e && e.message ? e.message : e) };
      }

      // Enrich with first-order date + purchase UTM (needs read_orders scope).
      try {
        const orderMap = await shopifyFirstOrderMap();
        if (orderMap) {
          let matched = 0, withUtm = 0;
          profiles.forEach((p) => {
            const o = orderMap[String(p.email || '').toLowerCase()];
            if (o) {
              matched++;
              if (o.date) p.purchase_date = o.date;
              if (o.utm && utmHasAny(o.utm)) { p.buy_utm = o.utm; withUtm++; } // Shopify auto-captured UTM
            }
          });
          dbg.orders = { ok: true, fetched: Object.keys(orderMap).length, matched, withUtm };
        }
      } catch (e) {
        dbg.orders = { ok: false, error: String(e && e.message ? e.message : e) };
      }

      if (DEBUG) out.debug = dbg;

      // Debug: /api/stats?key=...&props=1 lists every property key seen across
      // profiles, so we can find the exact UTM custom-property key.
      if (req.query && req.query.props === '1') {
        const keys = {};
        raw.forEach((p) => {
          const pr = ((p.attributes || {}).properties) || {};
          Object.keys(pr).forEach((k) => { keys[k] = true; });
        });
        out.debugPropertyKeys = Object.keys(keys);
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
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers.json?limit=250&fields=email,orders_count,total_spent,tags`;
  const map = {};
  for (let page = 0; page < 8 && url; page++) {
    const r = await fetch(url, { headers });
    if (!r.ok) { if (page === 0) throw new Error(`Shopify ${r.status}`); break; }
    const j = await r.json().catch(() => ({}));
    (j.customers || []).forEach((c) => {
      if (!c.email) return;
      // Signup source stored as a "utm:<source>" tag at registration.
      let utm = '';
      (c.tags || '').split(',').forEach((t) => {
        const tag = t.trim();
        if (tag.toLowerCase().indexOf('utm:') === 0) utm = tag.slice(4).trim();
      });
      map[c.email.toLowerCase()] = { orders: c.orders_count || 0, spent: c.total_spent || '0.00', utm: utm };
    });
    const link = r.headers.get('link') || r.headers.get('Link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return map;
}

function emptyUtm() {
  return { source: '', medium: '', campaign: '', term: '', content: '' };
}

function utmHasAny(u) {
  return !!(u && (u.source || u.medium || u.campaign || u.term || u.content));
}

// Registration UTM stored on the Klaviyo profile. Prefer our own lowercase
// keys (written by lib/klaviyo.js), fall back to Klaviyo's auto-tracked
// "UTM Source"/… properties.
function regUtmFromProps(props) {
  props = props || {};
  const pick = (a, b) => props[a] || props[b] || '';
  return {
    source: pick('utm_source', 'UTM Source'),
    medium: pick('utm_medium', 'UTM Medium'),
    campaign: pick('utm_campaign', 'UTM Campaign'),
    term: pick('utm_term', 'UTM Term'),
    content: pick('utm_content', 'UTM Content'),
  };
}

// Extract all five UTM values from an order landing_site URL (Shopify captures
// this automatically at checkout).
function parseUtmAll(landing) {
  const out = emptyUtm();
  try {
    const s = String(landing || '');
    const qi = s.indexOf('?');
    if (qi < 0) return out;
    const params = new URLSearchParams(s.slice(qi + 1));
    out.source = params.get('utm_source') || '';
    out.medium = params.get('utm_medium') || '';
    out.campaign = params.get('utm_campaign') || '';
    out.term = params.get('utm_term') || '';
    out.content = params.get('utm_content') || '';
  } catch (e) { /* ignore */ }
  return out;
}

// Map of lowercased email -> { date, utm } from Shopify orders (earliest
// order date + UTM auto-captured in landing_site). Needs read_orders.
async function shopifyFirstOrderMap() {
  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) return null;
  const token = await getShopifyAccessToken();
  const headers = { 'X-Shopify-Access-Token': token, Accept: 'application/json' };
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=250&fields=email,customer,created_at,landing_site`;
  const map = {};
  for (let page = 0; page < 12 && url; page++) {
    const r = await fetch(url, { headers });
    if (!r.ok) { if (page === 0) throw new Error(`Shopify ${r.status}`); break; }
    const j = await r.json().catch(() => ({}));
    (j.orders || []).forEach((o) => {
      const em = String((o.customer && o.customer.email) || o.email || '').toLowerCase();
      if (!em || !o.created_at) return;
      const u = parseUtmAll(o.landing_site);
      if (!map[em]) {
        map[em] = { date: o.created_at, utm: u };
      } else {
        if (o.created_at < map[em].date) map[em].date = o.created_at; // keep earliest date
        if (!utmHasAny(map[em].utm) && utmHasAny(u)) map[em].utm = u; // keep first non-empty UTM
      }
    });
    const link = r.headers.get('link') || r.headers.get('Link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return map;
}
