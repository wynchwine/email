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

async function upsertProfile({ email, firstName, utm = {} }) {
  const props = { source: 'landing_signup', signup_at: new Date().toISOString() };
  if (utm.utm_source) props.utm_source = utm.utm_source;
  if (utm.utm_medium) props.utm_medium = utm.utm_medium;
  if (utm.utm_campaign) props.utm_campaign = utm.utm_campaign;
  if (utm.utm_term) props.utm_term = utm.utm_term;
  if (utm.utm_content) props.utm_content = utm.utm_content;
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
          properties: props,
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

// With marketing consent: set the profile's name/utm via profile-import (which
// accepts first_name + properties), then subscribe it to the newsletter list.
// Without consent (or no list configured): just create/update the profile.
// Returns { ok, method, status, body } so callers can tell which path ran.
export async function subscribeKlaviyo({ email, firstName, marketing = true, utm = {} }) {
  const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;
  if (marketing && listId) {
    // Best-effort: record the name/utm/properties. Don't block subscription on it.
    try { await upsertProfile({ email, firstName, utm }); } catch (err) {
      console.error('[klaviyo] profile upsert before subscribe failed:', err);
    }
    return subscribeToList({ email, listId });
  }
  return upsertProfile({ email, firstName, utm });
}
