// Klaviyo flow statistics endpoint. Protected by DASHBOARD_TOKEN.
//
//   GET /api/flows?key=<DASHBOARD_TOKEN>&timeframe=last_30_days
//
// Pulls the list of flows (for names/status) + a flow-values-report
// (recipients, opens, clicks, conversions, revenue) and aggregates the
// per-message rows up to one row per flow.

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

// Timeframe keys we allow the dashboard to request (mapped straight to Klaviyo).
const TIMEFRAMES = new Set(['last_7_days', 'last_30_days', 'last_3_months', 'last_12_months']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.DASHBOARD_TOKEN || '12345678';
  const key = req.query && req.query.key ? String(req.query.key) : '';
  if (key !== token) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'KLAVIYO_API_KEY is not set in Vercel.' });

  const timeframe = TIMEFRAMES.has(String(req.query.timeframe || '')) ? String(req.query.timeframe) : 'last_30_days';

  const headers = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: KLAVIYO_REVISION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  // ---- 1. Flow id -> { name, status } ----
  const flowMap = {};
  try {
    let url = `${KLAVIYO_BASE}/flows/?page[size]=50&fields[flow]=name,status`;
    for (let page = 0; page < 6 && url; page++) {
      const r = await fetch(url, { headers });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) break;
      (b.data || []).forEach((f) => {
        const a = f.attributes || {};
        flowMap[f.id] = { name: a.name || f.id, status: a.status || '' };
      });
      url = b.links && b.links.next ? b.links.next : null;
    }
  } catch (e) { /* names are best-effort */ }

  // ---- 2. Conversion metric id (required by flow-values-reports) ----
  // Prefer the Shopify "Placed Order" metric; fall back to the first metric.
  let conversionMetricId = '';
  try {
    const r = await fetch(`${KLAVIYO_BASE}/metrics/?page[size]=100`, { headers });
    const b = await r.json().catch(() => ({}));
    const metrics = b.data || [];
    const placed = metrics.find((m) => /placed order/i.test((m.attributes && m.attributes.name) || ''));
    conversionMetricId = (placed || metrics[0] || {}).id || '';
  } catch (e) { /* handled below */ }

  if (!conversionMetricId) {
    return res.status(200).json({ error: 'Could not resolve a conversion metric (needs metrics read access).' });
  }

  // ---- 3. Flow values report ----
  const statistics = ['recipients', 'opens_unique', 'clicks_unique', 'conversion_uniques', 'conversion_value'];
  let results = [];
  try {
    const r = await fetch(`${KLAVIYO_BASE}/flow-values-reports/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          type: 'flow-values-report',
          attributes: {
            statistics,
            timeframe: { key: timeframe },
            conversion_metric_id: conversionMetricId,
          },
        },
      }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(200).json({ error: `Klaviyo ${r.status}`, detail: JSON.stringify(b).slice(0, 300) });
    }
    results = (b.data && b.data.attributes && b.data.attributes.results) || [];
  } catch (e) {
    return res.status(200).json({ error: String(e && e.message ? e.message : e) });
  }

  // ---- 4. Aggregate per-message rows into one row per flow ----
  const byFlow = {};
  results.forEach((row) => {
    const g = row.groupings || {};
    const fid = g.flow_id;
    if (!fid) return;
    const s = row.statistics || {};
    if (!byFlow[fid]) {
      const meta = flowMap[fid] || {};
      byFlow[fid] = {
        flow_id: fid,
        name: meta.name || fid,
        status: meta.status || '',
        recipients: 0,
        opens_unique: 0,
        clicks_unique: 0,
        conversions: 0,
        revenue: 0,
      };
    }
    const acc = byFlow[fid];
    acc.recipients += Number(s.recipients || 0);
    acc.opens_unique += Number(s.opens_unique || 0);
    acc.clicks_unique += Number(s.clicks_unique || 0);
    acc.conversions += Number(s.conversion_uniques || 0);
    acc.revenue += Number(s.conversion_value || 0);
  });

  const flows = Object.keys(byFlow)
    .map((fid) => {
      const f = byFlow[fid];
      return {
        ...f,
        open_rate: f.recipients ? f.opens_unique / f.recipients : 0,
        click_rate: f.recipients ? f.clicks_unique / f.recipients : 0,
      };
    })
    .sort((a, b) => b.recipients - a.recipients);

  return res.status(200).json({ timeframe, flows });
}
