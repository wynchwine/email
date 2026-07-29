// Dashboard data endpoint (Klaviyo-based). Protected by DASHBOARD_TOKEN.
//
//   GET /api/stats?key=<DASHBOARD_TOKEN>
//
// Registrations = Klaviyo profiles created via our landing (properties.source
// == "landing_signup"). Subscribers = confirmed members of the Club list.

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';
const SOURCE = 'landing_signup';
const MAX_PAGES = 8; // up to 800 profiles
// Hide test registrations from before this date (UTC). Set to '' to show all.
const CUTOFF = '2026-07-27T00:00:00Z';

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
          const props = a.properties;
          if (!props || props.source !== SOURCE) return false;
          if (CUTOFF && a.created && a.created < CUTOFF) return false; // hide pre-cutoff test data
          return true;
        })
        .map((p) => {
          const a = p.attributes || {};
          const consent = a.subscriptions && a.subscriptions.email && a.subscriptions.email.marketing && a.subscriptions.email.marketing.consent;
          return {
            name: [a.first_name, a.last_name].filter(Boolean).join(' '),
            email: a.email,
            created_at: a.created,
            marketing: consent === 'SUBSCRIBED',
          };
        });
      out.registrations = { count: profiles.length, profiles: profiles.slice(0, 200) };
    }
  } catch (e) {
    out.registrations = { error: String(e && e.message ? e.message : e) };
  }

  return res.status(200).json(out);
}
