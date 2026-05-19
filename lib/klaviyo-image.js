const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

export async function uploadImageToKlaviyo({ base64, mimeType, name }) {
  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const filename = `${name}.${ext}`;
  const imageBuffer = Buffer.from(base64, 'base64');

  const formData = new FormData();
  formData.append('image', new Blob([imageBuffer], { type: mimeType }), filename);
  formData.append('name', filename);

  console.log('[klaviyo-img] uploading', filename, Math.round(imageBuffer.length / 1024), 'KB');
  const res = await fetch(`${KLAVIYO_BASE}/images/`, {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_API_KEY}`,
      revision: KLAVIYO_REVISION,
    },
    body: formData,
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`Klaviyo image upload failed ${res.status}: ${body.slice(0, 300)}`);

  const json = JSON.parse(body);
  const url = json.data?.attributes?.image_url;
  if (!url) throw new Error('Klaviyo image upload: no URL in response');
  console.log('[klaviyo-img] uploaded:', url);
  return url;
}
