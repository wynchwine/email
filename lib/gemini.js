const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';

async function fetchImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  return { data: Buffer.from(buffer).toString('base64'), mimeType };
}

export async function generateHeroImage({ productImageUrls, baseImageUrl }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const count = productImageUrls.length;
  const promptText = count === 1
    ? 'Replace the wine bottles in this image with the provided product bottle. Show exactly one bottle in the same natural flat-lay composition on the concrete surface. Keep the original lighting, hard shadows, and wine glasses exactly as they are.'
    : `Replace the wine bottles in this image with the provided ${count} product bottle images. Arrange all ${count} bottles naturally in the flat-lay composition on the concrete surface. Keep the original lighting, hard shadows, and wine glasses exactly as they are.`;

  console.log('[gemini] fetching', 1 + productImageUrls.length, 'images...');
  const [baseImage, ...productImages] = await Promise.all([
    fetchImageAsBase64(baseImageUrl),
    ...productImageUrls.map(fetchImageAsBase64),
  ]);

  const parts = [
    { text: promptText },
    { inlineData: { mimeType: baseImage.mimeType, data: baseImage.data } },
    ...productImages.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
  ];

  console.log('[gemini] calling', GEMINI_IMAGE_MODEL, '...');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    }
  );

  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${body.slice(0, 400)}`);

  const json = JSON.parse(body);
  const imagePart = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!imagePart) throw new Error('Gemini returned no image in response');

  console.log('[gemini] image generated, mimeType:', imagePart.inlineData.mimeType);
  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/jpeg',
  };
}
