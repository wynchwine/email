import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';
const SHOPIFY_BASE = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-01`;

function verifyShopifyHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

async function fetchProductData(productId) {
  const res = await fetch(`${SHOPIFY_BASE}/products/${productId}.json?fields=title,tags,body_html`, {
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN },
  });
  if (!res.ok) return {};
  const { product } = await res.json();
  const tags = (product.tags || '').split(',').map(t => t.trim());
  const data = { title: product.title, description: (product.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
  for (const tag of tags) {
    const parts = tag.split('::');
    if (parts[0] === 'secondary' && parts.length >= 3) {
      data[parts[1]] = parts.slice(2).join('::');
    }
  }
  return data;
}

async function getKlaviyoProfileByEmail(email) {
  const filter = encodeURIComponent(`equals(email,"${email}")`);
  const res = await fetch(`${KLAVIYO_BASE}/profiles/?filter=${filter}&fields[profile]=id,properties`, {
    headers: {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
      revision: KLAVIYO_REVISION,
    },
  });
  if (!res.ok) return null;
  const { data } = await res.json();
  return data?.[0] ?? null;
}

async function updateKlaviyoProfile(profileId, properties) {
  const res = await fetch(`${KLAVIYO_BASE}/profiles/${profileId}/`, {
    method: 'PATCH',
    headers: {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
      revision: KLAVIYO_REVISION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'profile',
        id: profileId,
        attributes: { properties },
      },
    }),
  });
  return res.ok;
}

async function generateSommelierNotes({ wines, preferences }) {
  const winesText = wines.map((w, i) =>
    [`Wine ${i + 1}: ${w.name}`, w.region && `Region: ${w.region}`, w.grape && `Grape: ${w.grape}`, w.aromas && `Aromas: ${w.aromas}`, w.description && `Description: ${w.description}`].filter(Boolean).join('\n')
  ).join('\n\n');

  const userPrompt = [
    winesText,
    preferences && `Customer preferences: ${preferences}`,
  ].filter(Boolean).join('\n');

  const fallbackEn = `We hope you enjoy your selection: ${wines.map(w => w.name).join(', ')}. Each bottle promises a memorable experience.`;
  const fallbackDe = `Wir hoffen, dass Sie Ihre Auswahl genießen: ${wines.map(w => w.name).join(', ')}. Jede Flasche verspricht ein unvergessliches Erlebnis.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      temperature: 0.8,
      system:
        'You are a warm, knowledgeable sommelier writing a personal note to a wine customer. ' +
        'The note goes inside a shipping notification email. ' +
        'Write one cohesive note covering all wines in the order, 4-6 sentences max. ' +
        'Base the note primarily on the product description provided. ' +
        'Be specific about each wine\'s aromas and character. Do not use any markdown formatting. ' +
        'Reference the customer\'s taste preferences naturally if provided. ' +
        'Mention serving temperatures and food pairings. ' +
        'Tone: personal, expert, never generic. ' +
        'Respond with valid JSON only: {"en": "...English note...", "de": "...German note..."}',
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0].text.trim();
    const json = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, ''));
    return { en: json.en || fallbackEn, de: json.de || fallbackDe };
  } catch {
    return { en: fallbackEn, de: fallbackDe };
  }
}

async function processOrder(order) {
  const customerEmail = order.email;
  console.log('[sommelier] processing order', order.id, 'email:', customerEmail);
  if (!customerEmail) { console.log('[sommelier] no email, skip'); return; }

  const lineItems = order.line_items;
  if (!lineItems?.length) { console.log('[sommelier] no line items, skip'); return; }

  const orderId = String(order.id);
  console.log('[sommelier] wines:', lineItems.map(i => i.title).join(', '));

  const [profile, ...productDataList] = await Promise.all([
    getKlaviyoProfileByEmail(customerEmail),
    ...lineItems.map(item => fetchProductData(item.product_id)),
  ]);

  console.log('[sommelier] klaviyo profile:', profile ? profile.id : 'NOT FOUND');

  if (!profile) { console.log('[sommelier] profile not found, skip'); return; }

  const existingOrderId = profile.attributes?.properties?.sommelier_note_order;
  if (existingOrderId === orderId) { console.log('[sommelier] duplicate order, skip'); return; }

  const preferences = profile.attributes?.properties?.wine_preferences ?? '';
  const locale = order.customer_locale ?? 'en';

  const wines = lineItems.map((item, i) => {
    const pd = productDataList[i] ?? {};
    const producer = pd.producer;
    const wineName = producer ? `${producer} ${pd.title || item.title}` : (pd.title || item.title);
    return {
      name: wineName,
      region: pd.region,
      grape: pd.grape,
      aromas: pd.aroma,
      description: pd.description,
    };
  });

  console.log('[sommelier] generating note for', wines.length, 'wine(s)...');
  const notes = await generateSommelierNotes({ wines, preferences });

  console.log('[sommelier] notes generated, updating klaviyo...');
  await updateKlaviyoProfile(profile.id, {
    sommelier_note_en: notes.en,
    sommelier_note_de: notes.de,
    sommelier_note_wine: wines.map(w => w.name).join(', '),
    sommelier_note_order: orderId,
    sommelier_note_updated_at: new Date().toISOString(),
  });
  console.log('[sommelier] done');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac) return res.status(401).end();

  let rawBody = '';
  for await (const chunk of req) {
    rawBody += chunk;
  }

  if (!verifyShopifyHmac(rawBody, hmac)) {
    return res.status(401).end();
  }

  let order;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return res.status(200).end();
  }

  await processOrder(order).catch(err => console.error('[sommelier] error:', err));
  res.status(200).end();
}
