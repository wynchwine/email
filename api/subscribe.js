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

  try {
    const ok = await subscribeKlaviyo({ email, firstName });
    if (!ok) {
      console.error('[subscribe] klaviyo rejected signup for', email);
      return res.status(502).json({ error: 'Could not save your email right now. Please try again.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[subscribe] error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
