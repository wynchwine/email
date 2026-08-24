// Delete a Klaviyo profile by email (used by the dashboard's delete button).
// Protected by DASHBOARD_TOKEN. Uses Klaviyo's data-privacy deletion job,
// which permanently removes the profile (asynchronously).
//
//   POST /api/delete-profile?key=<DASHBOARD_TOKEN>   body: { "email": "..." }

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

async function readBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const token = process.env.DASHBOARD_TOKEN || '12345678';
  const key = req.query && req.query.key ? String(req.query.key) : '';
  if (key !== token) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, error: 'KLAVIYO_API_KEY not set' });

  let body;
  try { body = await readBody(req); } catch { return res.status(400).json({ ok: false, error: 'Invalid body' }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: 'email required' });

  const headers = { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: KLAVIYO_REVISION, 'Content-Type': 'application/json', Accept: 'application/json' };

  try {
    // Look up the profile ID by email.
    const filter = encodeURIComponent(`equals(email,"${email}")`);
    const lookup = await fetch(`${KLAVIYO_BASE}/profiles/?filter=${filter}`, { headers });
    const lb = await lookup.json().catch(() => ({}));
    if (!lookup.ok) {
      return res.status(502).json({ ok: false, error: `Klaviyo ${lookup.status}`, detail: JSON.stringify(lb).slice(0, 200) });
    }
    const id = lb.data && lb.data[0] && lb.data[0].id;
    if (!id) return res.status(404).json({ ok: false, error: 'Профиль с таким email не найден' });

    // Queue a permanent deletion (GDPR data-privacy job).
    const del = await fetch(`${KLAVIYO_BASE}/data-privacy-deletion-jobs/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: { type: 'data-privacy-deletion-job', attributes: { profile: { data: { type: 'profile', id } } } },
      }),
    });
    if (del.ok || del.status === 202) return res.status(200).json({ ok: true, id });
    const t = await del.text();
    return res.status(502).json({ ok: false, error: `Klaviyo ${del.status}`, detail: t.slice(0, 200) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
