import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { fetchProductData } from '../lib/shopify.js';
import { generateHeroImage } from '../lib/gemini.js';
import { uploadImageToKlaviyo } from '../lib/klaviyo-image.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const activeCheckouts = new Set();

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

function verifyShopifyHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
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
    const hasPreferences = Boolean(preferences);
    const matchBlockInstructions = hasPreferences
      ? '\n\n3. A third block ONLY because the customer\'s taste preferences are provided. Start it with a short heading line — "Why these wines suit you?" in English, "Warum diese Weine zu Ihnen passen?" in German — followed by a blank line, then exactly three short points explaining why each wine fits the customer\'s preferences. Separate the three points with a blank line between them. Do not use bullets, dashes, or numbers — just plain sentences separated by blank lines.'
      : '\n\nDo NOT add any "Why these wines suit you?" block, because no customer taste preferences were provided.';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0.8,
      system:
        'You are a warm, knowledgeable sommelier writing a personalized abandoned cart recovery note. ' +
        'Structure the note exactly like this:\n' +
        '1. One sentence complimenting the customer\'s taste and explaining why their selection shows great wine instinct.\n' +
        '2. Three facts about why this specific order is exceptional — write them as flowing prose, not a numbered list. Each fact should be concrete and specific to the wines, referencing regions, grapes, or characteristics.' +
        matchBlockInstructions + '\n' +
        'Separate every numbered section above with a blank line (double newline). ' +
        'No markdown. No asterisks. No numbered lists. No dashes or bullets. Tone: warm, expert, flattering but never pushy. ' +
        'You MUST respond in this exact format:\n<en>English text here</en>\n<de>German text here</de>',
      messages: [{ role: 'user', content: userPrompt || 'Write a warm note for the wines listed.' }],
    });

    const raw = message.content[0].text.trim();
    console.log('[abandoned] claude raw:', raw.slice(0, 300));
    const en = raw.match(/<en>([\s\S]*?)<\/en>/)?.[1]?.trim();
    const de = raw.match(/<de>([\s\S]*?)<\/de>/)?.[1]?.trim();
    return { en: en || fallbackEn, de: de || fallbackDe };
  } catch (err) {
    console.error('[abandoned] claude error:', err.message, err.stack?.slice(0, 300));
    return { en: fallbackEn, de: fallbackDe };
  }
}

async function generateAndUploadHeroImage({ productDataList, checkoutId }) {
  const baseImageUrl = process.env.HERO_BASE_IMAGE_URL;
  const fallbackUrl = baseImageUrl || null;

  const productImageUrls = [...new Set(productDataList.map(pd => pd.imageUrl).filter(Boolean))].slice(0, 5);
  if (!productImageUrls.length) {
    console.log('[hero] no product images, using fallback');
    return fallbackUrl;
  }
  if (!baseImageUrl) {
    console.log('[hero] HERO_BASE_IMAGE_URL not set, skipping generation');
    return null;
  }

  try {
    console.log('[hero] generating image for', productImageUrls.length, 'product(s)...');
    const generated = await generateHeroImage({ productImageUrls, baseImageUrl });
    const name = `abandoned-hero-${checkoutId}-${Date.now()}`;
    const url = await uploadImageToKlaviyo({ ...generated, name });
    return url;
  } catch (err) {
    console.error('[hero] generation failed, using fallback:', err.message);
    return fallbackUrl;
  }
}

async function processCheckout(checkout) {
  const lockKey = String(checkout.token || checkout.id);
  if (activeCheckouts.has(lockKey)) { console.log('[abandoned] already in-flight, skip'); return; }
  activeCheckouts.add(lockKey);
  try {
    await _processCheckout(checkout);
  } finally {
    activeCheckouts.delete(lockKey);
  }
}

async function _processCheckout(checkout) {
  const customerEmail = checkout.email || checkout.customer?.email;
  console.log('[abandoned] processing checkout', checkout.id, 'email:', customerEmail);
  console.log('[abandoned] payload keys:', Object.keys(checkout).join(', '));
  console.log('[abandoned] customer:', JSON.stringify(checkout.customer ?? null));
  if (!customerEmail) { console.log('[abandoned] no email, skip'); return; }

  const lineItems = checkout.line_items;
  if (!lineItems?.length) { console.log('[abandoned] no line items, skip'); return; }

  console.log('[abandoned] wines:', lineItems.map(i => i.title).join(', '));
  console.log('[abandoned] product_ids:', lineItems.map(i => i.product_id).join(', '));

  const [profile, ...productDataList] = await Promise.all([
    getKlaviyoProfileByEmail(customerEmail),
    ...lineItems.map(item => fetchProductData(item.product_id)),
  ]);

  console.log('[abandoned] klaviyo profile:', profile ? profile.id : 'NOT FOUND');
  productDataList.forEach((pd, i) => console.log(`[abandoned] product[${i}]:`, JSON.stringify(pd)));
  if (!profile) { console.log('[abandoned] profile not found, skip'); return; }

  const checkoutId = String(checkout.token || checkout.id);
  const winesSig = lineItems.map(i => `${i.product_id}x${i.quantity || 1}`).join(',');
  const dedupKey = `${checkoutId}::${winesSig}`;
  const existingKey = profile.attributes?.properties?.abandoned_checkout_dedup;
  if (existingKey === dedupKey) { console.log('[abandoned] duplicate checkout+wines, skip'); return; }

  const props2 = profile.attributes?.properties ?? {};
  const fmt = v => (v == null || v === '') ? null : (typeof v === 'string' ? v : JSON.stringify(v));
  const prefParts = [
    fmt(props2.userPreferences) && `Preferences: ${fmt(props2.userPreferences)}`,
    fmt(props2.quiz_tannin) && `Tannin: ${fmt(props2.quiz_tannin)}`,
    fmt(props2.quiz_sweetness) && `Sweetness: ${fmt(props2.quiz_sweetness)}`,
    fmt(props2.quiz_acidity) && `Acidity: ${fmt(props2.quiz_acidity)}`,
    fmt(props2.quiz_aromatic_profile) && `Aromatic profile: ${fmt(props2.quiz_aromatic_profile)}`,
  ].filter(Boolean);
  const preferences = prefParts.join('. ');
  console.log('[abandoned] preferences:', preferences || '(none)');

  const wines = lineItems.map((item, i) => {
    const pd = productDataList[i] ?? {};
    const producer = pd.producer;
    const wineName = producer ? `${producer} ${pd.title || item.title}` : (pd.title || item.title);
    return { name: wineName, region: pd.region, grape: pd.grape, aromas: pd.aroma, description: pd.description };
  });

  console.log('[abandoned] generating note for', wines.length, 'wine(s)...');
  const notes = await generateAbandonedCheckoutNote({ wines, preferences });

  const heroImageUrl = await generateAndUploadHeroImage({ productDataList, checkoutId });

  const props = {
    abandoned_checkout_note_en: notes.en,
    abandoned_checkout_note_de: notes.de,
    abandoned_checkout_wines: wines.map(w => w.name).join(', '),
    abandoned_checkout_id: checkoutId,
    abandoned_checkout_dedup: dedupKey,
    abandoned_checkout_updated_at: new Date().toISOString(),
  };
  if (heroImageUrl) props.abandoned_checkout_hero_image = heroImageUrl;

  console.log('[abandoned] updating klaviyo...');
  await updateKlaviyoProfile(profile.id, props);
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
