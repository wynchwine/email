const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

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

// Subscribe a profile to a Klaviyo list with email marketing consent.
// Uses the bulk subscribe job so double opt-in / consent settings on the
// list are respected. Falls back to a plain profile upsert if no list is set.
async function subscribeToList({ email, firstName, listId }) {
  const res = await fetch(`${KLAVIYO_BASE}/profile-subscription-bulk-create-jobs/`, {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
      revision: KLAVIYO_REVISION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          profiles: {
            data: [
              {
                type: 'profile',
                attributes: {
                  email,
                  ...(firstName ? { first_name: firstName } : {}),
                  subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } },
                },
              },
            ],
          },
        },
        relationships: { list: { data: { type: 'list', id: listId } } },
      },
    }),
  });
  return res.ok;
}

async function upsertProfile({ email, firstName }) {
  const res = await fetch(`${KLAVIYO_BASE}/profile-import/`, {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
      revision: KLAVIYO_REVISION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'profile',
        attributes: {
          email,
          ...(firstName ? { first_name: firstName } : {}),
          properties: { source: 'landing_signup', signup_at: new Date().toISOString() },
        },
      },
    }),
  });
  return res.ok;
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
    const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;
    const ok = listId
      ? await subscribeToList({ email, firstName, listId })
      : await upsertProfile({ email, firstName });

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
