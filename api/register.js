import { getShopifyAccessToken } from '../lib/shopify.js';
import { subscribeKlaviyo } from '../lib/klaviyo.js';

const SHOPIFY_API_VERSION = '2024-01';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function splitName(full) {
  const parts = full.trim().split(/\s+/);
  const first = parts.shift() || '';
  const last = parts.join(' ');
  return { first, last };
}

// Create an enabled Shopify customer account with a password.
// Shopify hashes and stores the password; we never persist it ourselves.
async function createShopifyCustomer({ firstName, lastName, email, password }) {
  const token = await getShopifyAccessToken();
  const shop = process.env.SHOPIFY_SHOP;

  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/customers.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      customer: {
        first_name: firstName,
        last_name: lastName,
        email,
        password,
        password_confirmation: password,
        send_email_welcome: false,
        // marketing consent is handled via Klaviyo; keep Shopify state explicit
        email_marketing_consent: { state: 'subscribed', opt_in_level: 'single_opt_in' },
      },
    }),
  });

  const text = await res.text();
  if (res.ok) return { ok: true };

  let errors = {};
  try { errors = JSON.parse(text).errors || {}; } catch { /* non-JSON */ }
  const emailErr = Array.isArray(errors.email) ? errors.email.join(' ') : '';
  const duplicate = res.status === 422 && /taken/i.test(emailErr);

  console.error('[register] shopify customer create failed', res.status, text.slice(0, 300));
  return { ok: false, status: res.status, duplicate, errors };
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

  const name = String(body.name ?? '').trim().slice(0, 100);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const password2 = String(body.password2 ?? '');

  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (password !== password2) return res.status(400).json({ error: 'Passwords do not match.' });

  const { first, last } = splitName(name);

  try {
    const result = await createShopifyCustomer({ firstName: first, lastName: last, email, password });

    if (!result.ok) {
      if (result.duplicate) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      return res.status(502).json({ error: 'Could not create your account right now. Please try again.' });
    }

    // Best-effort marketing subscription; don't fail registration if this errors.
    try {
      await subscribeKlaviyo({ email, firstName: first });
    } catch (err) {
      console.error('[register] klaviyo subscribe error:', err);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[register] error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
