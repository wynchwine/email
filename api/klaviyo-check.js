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

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.KLAVIYO_API_KEY;
  const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;
  const email = (req.query && req.query.email ? String(req.query.email) : '').trim().toLowerCase();

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

  // Live subscribe test — identical payload to the real signup flow.
  try {
    const r = await fetch(`${KLAVIYO_BASE}/profile-subscription-bulk-create-jobs/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          type: 'profile-subscription-bulk-create-job',
          attributes: {
            custom_source: 'Diagnostic test',
            profiles: {
              data: [
                {
                  type: 'profile',
                  attributes: {
                    email,
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
    const raw = await r.text();
    out.subscribeTest = { email, status: r.status, ok: r.ok, body: raw.slice(0, 600) || '(empty)' };

    if (r.status === 202 || r.ok) {
      out.hint = 'Subscribe accepted by Klaviyo (202 = queued). If the list is double opt-in, a confirmation email should now be sent to this address. Check inbox + spam. If it never arrives, the issue is Klaviyo email delivery/sending-domain, not the code.';
    } else {
      out.hint = 'Klaviyo REJECTED the subscribe call — see subscribeTest.body for the reason.';
    }
  } catch (e) {
    out.subscribeTest = { email, error: String(e && e.message ? e.message : e) };
    out.hint = 'Could not reach Klaviyo from the server.';
  }

  return res.status(200).json(out);
}
