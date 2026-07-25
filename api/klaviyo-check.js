// Diagnostic endpoint: open this in the browser to check the Klaviyo setup
// without reading server logs. It never returns secrets — only whether the
// env vars are present and whether the configured list ID is valid.
//
//   https://<your-vercel-domain>/api/klaviyo-check
//
// Remove this file once the newsletter list is confirmed working.

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.KLAVIYO_API_KEY;
  const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;

  const out = {
    hasApiKey: !!key,
    apiKeyPrefix: key ? key.slice(0, 3) : null, // "pk_" expected, never the full key
    hasListId: !!listId,
    listId: listId || null,
    hint: null,
    listLookup: null,
  };

  if (!key) {
    out.hint = 'KLAVIYO_API_KEY is not set in Vercel. Add it and redeploy.';
    return res.status(200).json(out);
  }
  if (!listId) {
    out.hint = 'KLAVIYO_NEWSLETTER_LIST_ID is not set in Vercel — signups create a profile but are never added to a list. Add it and redeploy.';
    return res.status(200).json(out);
  }

  try {
    const r = await fetch(`${KLAVIYO_BASE}/lists/${listId}/`, {
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: KLAVIYO_REVISION,
        Accept: 'application/json',
      },
    });
    const body = await r.json().catch(() => ({}));
    const attrs = body && body.data && body.data.attributes ? body.data.attributes : {};
    out.listLookup = {
      status: r.status,
      valid: r.ok,
      name: attrs.name || null,
      opt_in_process: attrs.opt_in_process || null, // "single_opt_in" or "double_opt_in"
      error: r.ok ? null : (body.errors || body),
    };

    if (!r.ok) {
      out.hint = r.status === 404
        ? 'This list ID was not found. Make sure it is a LIST (Lists & Segments → the list → its ID), not a segment, and that it belongs to this Klaviyo account.'
        : 'Klaviyo rejected the request. Check that KLAVIYO_API_KEY is a Private key (pk_...) with list permissions.';
    } else if (attrs.opt_in_process === 'double_opt_in') {
      out.hint = 'The list is valid but uses DOUBLE opt-in: new signups get a confirmation email and stay "pending" until they click it — they will not appear as subscribed members immediately. Switch the list to single opt-in in Klaviyo if you want them added right away.';
    } else {
      out.hint = 'Looks good: API key present, list ID valid, single opt-in. New signups should appear in this list within a minute.';
    }
  } catch (e) {
    out.listLookup = { error: String(e && e.message ? e.message : e) };
    out.hint = 'Could not reach Klaviyo from the server.';
  }

  return res.status(200).json(out);
}
