const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

// Subscribe a profile to a Klaviyo list with email marketing consent.
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

// With marketing consent: subscribe to the newsletter list (if configured).
// Without: just create/update the profile (no list, no consent).
export async function subscribeKlaviyo({ email, firstName, marketing = true }) {
  const listId = process.env.KLAVIYO_NEWSLETTER_LIST_ID;
  if (marketing && listId) return subscribeToList({ email, firstName, listId });
  return upsertProfile({ email, firstName });
}
