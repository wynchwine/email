let cachedToken = null;
let tokenExpiresAt = 0;

export async function getShopifyAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const shop = process.env.SHOPIFY_SHOP;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify token fetch failed ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
  return cachedToken;
}

export async function fetchProductData(productId) {
  const token = await getShopifyAccessToken();
  const shop = process.env.SHOPIFY_SHOP;
  const res = await fetch(`https://${shop}/admin/api/2024-01/products/${productId}.json?fields=title,tags,body_html`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  console.log(`[shopify] product ${productId} status:`, res.status);
  if (!res.ok) {
    const body = await res.text();
    console.log(`[shopify] error:`, body.slice(0, 200));
    return {};
  }
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
