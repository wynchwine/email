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
async function createShopifyCustomer({ firstName, lastName, email, password, marketing, utm }) {
  const token = await getShopifyAccessToken();
  const shop = process.env.SHOPIFY_SHOP;

  // Store the signup source as a tag (utm:<source>) so the dashboard can read
  // it straight from the Shopify customer (no dependency on Klaviyo keys).
  const utmSrc = String((utm && utm.utm_source) || '').replace(/,/g, ' ').trim().slice(0, 60);
  const tags = utmSrc ? ('wynch-landing, utm:' + utmSrc) : 'wynch-landing';

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
        // Mark customers created via the landing (+ signup source) so the
        // dashboard can filter and show the source from Shopify directly.
        tags: tags,
        // Send Shopify's default account welcome email on registration.
        send_email_welcome: true,
        // Marketing consent is owned entirely by Klaviyo (the Club list). Do
        // NOT mark the Shopify customer subscribed here — otherwise the
        // Klaviyo<>Shopify integration ALSO subscribes them, producing a
        // second list + a second double opt-in email.
        email_marketing_consent: { state: 'not_subscribed', opt_in_level: 'single_opt_in' },
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
  return { ok: false, status: res.status, duplicate, errors, raw: text.slice(0, 300) };
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

  const marketing = body.marketing !== false; // default: subscribe to marketing
  // Signup source written to the Klaviyo profile (lets copies of the landing
  // report a different source). Defaults to landing_signup.
  const source = String(body.source ?? '').trim().slice(0, 60) || 'landing_signup';
  const utm = {
    utm_source: String(body.utm_source ?? '').trim().slice(0, 100),
    utm_medium: String(body.utm_medium ?? '').trim().slice(0, 100),
    utm_campaign: String(body.utm_campaign ?? '').trim().slice(0, 100),
    utm_term: String(body.utm_term ?? '').trim().slice(0, 100),
    utm_content: String(body.utm_content ?? '').trim().slice(0, 100),
  };
  const { first, last } = splitName(name);

  try {
    const result = await createShopifyCustomer({ firstName: first, lastName: last, email, password, marketing, utm });

    // Hard failure (not a duplicate) — stop here.
    if (!result.ok && !result.duplicate) {
      // Real reason is logged server-side (see createShopifyCustomer); keep the
      // user-facing message neutral.
      return res.status(502).json({ error: 'Could not create your account right now. Please try again.' });
    }

    // Best-effort Klaviyo profile/subscription. Runs for BOTH a freshly created
    // customer and a duplicate one, so returning/re-registering users still get
    // the profile + double opt-in confirmation email.
    try {
      await subscribeKlaviyo({ email, firstName: first, marketing, utm, source });
    } catch (err) {
      console.error('[register] klaviyo subscribe error:', err);
    }

    // Duplicate email: the account already exists; the login step logs them in.
    if (result.duplicate) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[register] error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
