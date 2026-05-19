const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview';

async function fetchImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  return { data: Buffer.from(buffer).toString('base64'), mimeType };
}

export async function generateHeroImage({ wineNames, baseImageUrl }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const wineList = wineNames.join(', ');
  const count = wineNames.length;
  const promptText = count === 1
    ? `Using this reference flat-lay photo as the scene, replace all wine bottles with exactly one bottle of "${wineList}". Output exactly ONE image in 16:9 landscape format. Keep the concrete surface, hard shadows, human hand pouring, and wine glasses exactly as in the reference.`
    : `Using this reference flat-lay photo as the scene, replace all wine bottles with ${count} bottles of these wines: ${wineList}. Arrange them naturally in the same flat-lay composition. Output exactly ONE image in 16:9 landscape format. Keep the concrete surface, hard shadows, human hand pouring, and wine glasses exactly as in the reference.`;

  console.log('[gemini] fetching base image...');
  const baseImage = await fetchImageAsBase64(baseImageUrl);

  const parts = [
    { text: promptText },
    { inlineData: { mimeType: baseImage.mimeType, data: baseImage.data } },
  ];

  console.log('[gemini] calling', GEMINI_IMAGE_MODEL, 'for wines:', wineList);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '16:9' },
        },
      }),
    }
  );

  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${body.slice(0, 400)}`);

  const json = JSON.parse(body);
  const parts2 = json.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts2.find(p => p.inlineData);
  if (!imagePart) {
    const textParts = parts2.filter(p => p.text).map(p => p.text).join(' ');
    throw new Error(`Gemini returned no image. Text: ${textParts.slice(0, 200)}`);
  }

  console.log('[gemini] image generated, mimeType:', imagePart.inlineData.mimeType);
  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/jpeg',
  };
}
