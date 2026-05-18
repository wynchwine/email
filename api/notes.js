const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== process.env.NOTES_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let allProfiles = [];
  let cursor = null;

  do {
    const url = new URL(`${KLAVIYO_BASE}/profiles/`);
    url.searchParams.set('fields[profile]', 'email,first_name,last_name,properties');
    url.searchParams.set('page[size]', '100');
    url.searchParams.set('sort', '-updated');
    if (cursor) url.searchParams.set('page[cursor]', cursor);

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
        revision: KLAVIYO_REVISION,
      },
    });

    if (!resp.ok) break;
    const json = await resp.json();
    const profiles = json.data ?? [];
    const withNotes = profiles.filter(p => p.attributes?.properties?.sommelier_note);
    allProfiles.push(...withNotes);

    cursor = json.links?.next ? new URL(json.links.next).searchParams.get('page[cursor]') : null;

    // stop after 500 profiles to avoid timeout
    if (allProfiles.length >= 500) break;
  } while (cursor && allProfiles.length < 100);

  const notes = allProfiles.map(p => ({
    email: p.attributes.email,
    name: [p.attributes.first_name, p.attributes.last_name].filter(Boolean).join(' '),
    note: p.attributes.properties.sommelier_note,
    wine: p.attributes.properties.sommelier_note_wine,
    order: p.attributes.properties.sommelier_note_order,
    updated_at: p.attributes.properties.sommelier_note_updated_at,
  }));

  res.status(200).json(notes);
}
