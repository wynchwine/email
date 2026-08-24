import { subscribeKlaviyo } from '../lib/klaviyo.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req) {
  if (req.body) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const firstName = String(body.name ?? '').trim().slice(0, 100);
  if (!firstName) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const marketing = body.marketing !== false; // default: subscribe to marketing
  const source = String(body.source ?? '').trim().slice(0, 60) || 'landing_signup';
  const utm = {
    utm_source: String(body.utm_source ?? '').trim().slice(0, 100),
    utm_medium: String(body.utm_medium ?? '').trim().slice(0, 100),
    utm_campaign: String(body.utm_campaign ?? '').trim().slice(0, 100),
    utm_term: String(body.utm_term ?? '').trim().slice(0, 100),
    utm_content: String(body.utm_content ?? '').trim().slice(0, 100),
  };

  try {
    const result = await subscribeKlaviyo({ email, firstName, marketing, utm, source });
    if (!result.ok) {
      console.error('[subscribe] klaviyo rejected signup for', email, result.status, result.body);
      return res.status(502).json({ error: 'Could not save your email right now. Please try again.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[subscribe] error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
