// Temporary diagnostic. Two modes:
//
//   /api/klaviyo-check
//       → reports whether env vars are set and validates the list ID.
//
//   /api/klaviyo-check?email=you+test1@gmail.com
//       → performs a REAL subscribe for that email (same call the signup
//         flow uses) and returns Klaviyo's raw response, so we can see if
//         the double opt-in email was triggered or if the call errored.
//
// Use a FRESH email each time — Klaviyo won't re-send the confirmation to a
// profile that is already pending/subscribed. Remove this file when done.

import { subscribeKlaviyo } from '../lib/klaviyo.js';

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.KLAVIYO_API_KEY;
  const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;
  // A "+" in the URL query decodes to a space, which breaks plus-addressed
  // test emails (e.g. you+test1@gmail.com). Convert spaces back to "+".
  const email = (req.query && req.query.email ? String(req.query.email) : '')
    .trim().toLowerCase().replace(/\s+/g, '+');

  const out = {
    hasApiKey: !!key,
    apiKeyPrefix: key ? key.slice(0, 3) : null,
    hasListId: !!listId,
    listId: listId || null,
    mode: email ? 'live-subscribe-test' : 'config-check',
    hint: null,
  };

  if (!key || !listId) {
    out.hint = 'KLAVIYO_API_KEY and/or KLAVIYO_NEWSLETTER_LIST_ID are not set in Vercel. Add them and redeploy.';
    return res.status(200).json(out);
  }

  const headers = {
    Authorization: `Klaviyo-API-Key ${key}`,
    revision: KLAVIYO_REVISION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Always validate the list.
  try {
    const r = await fetch(`${KLAVIYO_BASE}/lists/${listId}/`, { headers });
    const b = await r.json().catch(() => ({}));
    const a = (b && b.data && b.data.attributes) || {};
    out.listLookup = { status: r.status, name: a.name || null, opt_in_process: a.opt_in_process || null };
  } catch (e) {
    out.listLookup = { error: String(e && e.message ? e.message : e) };
  }

  if (!email) {
    out.hint = 'Config looks set. Now call this URL again with ?email=you+test1@gmail.com (a FRESH address) to run a live subscribe test.';
    return res.status(200).json(out);
  }

  // Live test using the EXACT function the real signup uses, so `method`
  // proves whether it subscribes to the list or only creates a profile.
  try {
    const result = await subscribeKlaviyo({ email, firstName: 'Test', marketing: true });
    out.subscribeTest = {
      email,
      method: result.method, // "subscribe-to-list" = real subscription; "upsert-profile" = profile only
      status: result.status,
      ok: result.ok,
      body: result.body || '(empty)',
    };

    if (result.method !== 'subscribe-to-list') {
      out.hint = 'It went through "upsert-profile" (profile only, NO subscription) — that means KLAVIYO_NEWSLETTER_LIST_ID is not visible to this deployment. Set it (and redeploy) so signups actually subscribe.';
    } else if (result.ok) {
      out.hint = 'Real subscribe path ran and Klaviyo accepted it (queued). On a double opt-in list a confirmation email should now be sent — check inbox + spam. If it never arrives, the issue is Klaviyo email delivery/sending-domain, not the code.';
    } else {
      out.hint = 'Real subscribe path ran but Klaviyo REJECTED it — see subscribeTest.body for the reason.';
    }
  } catch (e) {
    out.subscribeTest = { email, error: String(e && e.message ? e.message : e) };
    out.hint = 'Could not reach Klaviyo from the server.';
  }

  return res.status(200).json(out);
}
