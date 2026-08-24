let cachedToken = null;
let tokenExpiresAt = 0;

export async function getShopifyAccessToken() {
  // Prefer a permanent custom-app Admin API token (shpat_...) if provided.
  if (process.env.SHOPIFY_ACCESS_TOKEN) return process.env.SHOPIFY_ACCESS_TOKEN;

  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const shop = process.env.SHOPIFY_SHOP;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  console.log('[shopify] requesting token for', shop, 'client_id:', clientId?.slice(0, 8) + '...', 'secret prefix:', clientSecret?.slice(0, 6));

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  const body = await res.text();
  console.log('[shopify] token response', res.status, body.slice(0, 500));

  if (!res.ok) {
    throw new Error(`Shopify token fetch failed ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = JSON.parse(body);
  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in - 60) * 1000;
  return cachedToken;
}

export async function fetchProductData(productId) {
  const token = await getShopifyAccessToken();
  const shop = process.env.SHOPIFY_SHOP;
  const res = await fetch(`https://${shop}/admin/api/2024-01/products/${productId}.json?fields=title,tags,body_html,images`, {
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
  const data = {
    title: product.title,
    description: (product.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    imageUrl: product.images?.[0]?.src ?? null,
  };
  for (const tag of tags) {
    const parts = tag.split('::');
    if (parts[0] === 'secondary' && parts.length >= 3) {
      data[parts[1]] = parts.slice(2).join('::');
    }
  }
  return data;
}
