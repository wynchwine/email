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
      data: { type: 'profile', id: profileId, attributes: { properties } },
    }),
  });
  return res.ok;
}

async function generateAbandonedCheckoutNote({ wines, preferences }) {
  const winesText = wines.map((w, i) =>
    [`Wine ${i + 1}: ${w.name}`, w.region && `Region: ${w.region}`, w.grape && `Grape: ${w.grape}`, w.aromas && `Aromas: ${w.aromas}`, w.description && `Description: ${w.description}`].filter(Boolean).join('\n')
  ).join('\n\n');

  const userPrompt = [
    winesText,
    preferences && `Customer taste preferences: ${preferences}`,
  ].filter(Boolean).join('\n\n');

  const fallbackEn = `You left some wonderful wines in your cart: ${wines.map(w => w.name).join(', ')}. Based on your taste preferences, we think you'll love them.`;
  const fallbackDe = `Sie haben einige wunderbare Weine in Ihrem Warenkorb: ${wines.map(w => w.name).join(', ')}. Basierend auf Ihren Geschmackspräferenzen denken wir, dass Sie sie lieben werden.`;

  console.log('[abandoned] calling claude...');
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      temperature: 0.8,
      system:
        'You are a warm, knowledgeable sommelier writing a personalized abandoned cart recovery email. ' +
        'For each wine the customer left in their cart, explain in 1-2 sentences why it perfectly matches their taste preferences. ' +
        'Write all wines as one flowing text, not a list. ' +
        'Base each explanation primarily on the product description. ' +
        'Be specific and personal — reference their actual preferences. ' +
        'Do not use any markdown formatting. ' +
        'Tone: warm, personal, expert, never pushy. ' +
        'Respond with valid JSON only: {"en": "...English text...", "de": "...German text..."}',
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0].text.trim();
    console.log('[abandoned] claude raw:', raw.slice(0, 500));
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      console.log('[abandoned] full response:', raw);
      throw new Error('no JSON in response');
    }
    const json = JSON.parse(match[0]);
    return { en: json.en || fallbackEn, de: json.de || fallbackDe };
  } catch (err) {
    console.error('[abandoned] claude error:', err.message, err.stack?.slice(0, 300));
    return { en: fallbackEn, de: fallbackDe };
  }
}

async function processCheckout(checkout) {
  const customerEmail = checkout.email || checkout.customer?.email;
  console.log('[abandoned] processing checkout', checkout.id, 'email:', customerEmail);
  console.log('[abandoned] payload keys:', Object.keys(checkout).join(', '));
  console.log('[abandoned] customer:', JSON.stringify(checkout.customer ?? null));
  if (!customerEmail) { console.log('[abandoned] no email, skip'); return; }

  const lineItems = checkout.line_items;
  if (!lineItems?.length) { console.log('[abandoned] no line items, skip'); return; }

  console.log('[abandoned] wines:', lineItems.map(i => i.title).join(', '));

  const [profile, ...productDataList] = await Promise.all([
    getKlaviyoProfileByEmail(customerEmail),
    ...lineItems.map(item => fetchProductData(item.product_id)),
  ]);

  console.log('[abandoned] klaviyo profile:', profile ? profile.id : 'NOT FOUND');
  if (!profile) { console.log('[abandoned] profile not found, skip'); return; }

  const preferences = profile.attributes?.properties?.wine_preferences ?? '';

  const wines = lineItems.map((item, i) => {
    const pd = productDataList[i] ?? {};
    const producer = pd.producer;
    const wineName = producer ? `${producer} ${pd.title || item.title}` : (pd.title || item.title);
    return { name: wineName, region: pd.region, grape: pd.grape, aromas: pd.aroma, description: pd.description };
  });

  console.log('[abandoned] generating note for', wines.length, 'wine(s)...');
  const notes = await generateAbandonedCheckoutNote({ wines, preferences });

  console.log('[abandoned] updating klaviyo...');
  await updateKlaviyoProfile(profile.id, {
    abandoned_checkout_note_en: notes.en,
    abandoned_checkout_note_de: notes.de,
    abandoned_checkout_wines: wines.map(w => w.name).join(', '),
    abandoned_checkout_updated_at: new Date().toISOString(),
  });
  console.log('[abandoned] done');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac) return res.status(401).end();

  let rawBody = '';
  for await (const chunk of req) rawBody += chunk;

  if (!verifyShopifyHmac(rawBody, hmac)) return res.status(401).end();

  let checkout;
  try {
    checkout = JSON.parse(rawBody);
  } catch {
    return res.status(200).end();
  }

  await processCheckout(checkout).catch(err => console.error('[abandoned] error:', err));
  res.status(200).end();
}
