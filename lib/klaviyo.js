const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

// Subscribe a profile to a Klaviyo list with email marketing consent.
// NOTE: the bulk-subscription endpoint only accepts email / phone_number /
// subscriptions in the profile — NOT first_name (Klaviyo returns 400). The
// name is set separately via profile-import (see subscribeKlaviyo).
async function subscribeToList({ email, listId }) {
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
          custom_source: 'Landing signup',
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
  let body = '';
  if (!res.ok) {
    body = await res.text();
    console.error('[klaviyo] subscribe-to-list failed', res.status, 'list:', listId, body.slice(0, 400));
  }
  return { ok: res.ok, method: 'subscribe-to-list', status: res.status, body: body.slice(0, 400) };
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
  let body = '';
  if (!res.ok) {
    body = await res.text();
    console.error('[klaviyo] profile-import failed', res.status, body.slice(0, 400));
  }
  return { ok: res.ok, method: 'upsert-profile', status: res.status, body: body.slice(0, 400) };
}

// With marketing consent: set the profile's name via profile-import (which
// accepts first_name), then subscribe it to the newsletter list. Without
// consent (or no list configured): just create/update the profile.
// Returns { ok, method, status, body } so callers can tell which path ran.
export async function subscribeKlaviyo({ email, firstName, marketing = true }) {
  const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;
  if (marketing && listId) {
    // Best-effort: record the name/properties. Don't block subscription on it.
    if (firstName) {
      try { await upsertProfile({ email, firstName }); } catch (err) {
        console.error('[klaviyo] name upsert before subscribe failed:', err);
      }
    }
    return subscribeToList({ email, listId });
  }
  return upsertProfile({ email, firstName });
}
