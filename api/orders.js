// Orders dashboard data endpoint. Protected by DASHBOARD_TOKEN.
//
//   GET /api/orders?key=<DASHBOARD_TOKEN>
//
// Returns Shopify orders with the UTM Shopify auto-captures in landing_site,
// plus order number, date, email, total, payment/fulfillment status and the
// storefront source (source_name / referring_site). Needs read_orders scope.

import { getShopifyAccessToken } from '../lib/shopify.js';

const SHOPIFY_API_VERSION = '2024-01';
const MAX_PAGES = 12; // up to 3000 orders

function emptyUtm() {
  return { source: '', medium: '', campaign: '', term: '', content: '' };
}
function utmHasAny(u) {
  return !!(u && (u.source || u.medium || u.campaign || u.term || u.content));
}
// Parse all five UTM values from an order landing_site URL.
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.DASHBOARD_TOKEN || '12345678';
  const key = req.query && req.query.key ? String(req.query.key) : '';
  if (key !== token) return res.status(401).json({ error: 'Unauthorized' });

  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) return res.status(200).json({ error: 'SHOPIFY_SHOP is not set in Vercel.' });

  let accessToken;
  try {
    accessToken = await getShopifyAccessToken();
  } catch (e) {
    return res.status(200).json({ error: 'Shopify auth failed: ' + String(e && e.message ? e.message : e) });
  }

  const headers = { 'X-Shopify-Access-Token': accessToken, Accept: 'application/json' };
  const fields = 'id,name,created_at,email,customer,total_price,currency,financial_status,fulfillment_status,landing_site,referring_site,source_name';
  let url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&limit=250&fields=${fields}`;

  const orders = [];
  try {
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const r = await fetch(url, { headers });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        if (page === 0) return res.status(200).json({ error: `Shopify ${r.status}`, detail: body.slice(0, 300) });
        break;
      }
      const j = await r.json().catch(() => ({}));
      (j.orders || []).forEach((o) => {
        const utm = parseUtmAll(o.landing_site);
        orders.push({
          order: o.name || String(o.id || ''),
          date: o.created_at || '',
          email: String((o.customer && o.customer.email) || o.email || ''),
          total: o.total_price != null ? Number(o.total_price) : null,
          currency: o.currency || 'EUR',
          financial_status: o.financial_status || '',
          fulfillment_status: o.fulfillment_status || '',
          utm,
          source_name: o.source_name || '',
          referrer: o.referring_site || '',
        });
      });
      const link = r.headers.get('link') || r.headers.get('Link') || '';
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    }
  } catch (e) {
    return res.status(200).json({ error: String(e && e.message ? e.message : e) });
  }

  // Newest first.
  orders.sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)));

  const withUtm = orders.filter((o) => utmHasAny(o.utm)).length;
  const revenue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  return res.status(200).json({
    count: orders.length,
    withUtm,
    revenue: Math.round(revenue * 100) / 100,
    orders: orders.slice(0, 500),
  });
}
