// Klaviyo flow statistics endpoint. Protected by DASHBOARD_TOKEN.
//
//   GET /api/flows?key=<DASHBOARD_TOKEN>&timeframe=last_30_days
//
// Pulls the list of flows (for names/status) + a flow-values-report
// (recipients, opens, clicks, conversions, revenue) and aggregates the
// per-message rows up to one row per flow.

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';
// Conversion metric for the flow report (Klaviyo "Placed Order"). Used when
// KLAVIYO_CONVERSION_METRIC_ID isn't set, so no Metrics read access is needed.
const DEFAULT_CONVERSION_METRIC_ID = 'St6RYY';

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
  // When set (by id via ?flow= or by name via ?flowName=), return per-message
  // rows for this single flow instead of the aggregated overview.
  let flowFilter = req.query && req.query.flow ? String(req.query.flow).replace(/[^A-Za-z0-9]/g, '') : '';
  const flowNameReq = req.query && req.query.flowName ? String(req.query.flowName) : '';

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

  // Resolve ?flowName= to an id (exact, case-insensitive) once flows are known.
  if (!flowFilter && flowNameReq) {
    const found = Object.keys(flowMap).find(
      (id) => (flowMap[id].name || '').toLowerCase() === flowNameReq.toLowerCase()
    );
    if (!found) return res.status(200).json({ error: 'Flow not found: ' + flowNameReq });
    flowFilter = found;
  }

  // ---- 2. Conversion metric id (required by flow-values-reports) ----
  // Use the explicit env override if set (no metrics read needed); otherwise
  // auto-discover the Shopify "Placed Order" metric, falling back to the first.
  let conversionMetricId = process.env.KLAVIYO_CONVERSION_METRIC_ID || DEFAULT_CONVERSION_METRIC_ID || '';
  let metricErr = '';
  if (!conversionMetricId) {
    try {
      const r = await fetch(`${KLAVIYO_BASE}/metrics/?page[size]=100`, { headers });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        metricErr = `Klaviyo ${r.status}: ${JSON.stringify(b).slice(0, 200)}`;
      } else {
        const metrics = b.data || [];
        const placed = metrics.find((m) => /placed order/i.test((m.attributes && m.attributes.name) || ''));
        conversionMetricId = (placed || metrics[0] || {}).id || '';
      }
    } catch (e) { metricErr = String(e && e.message ? e.message : e); }
  }

  if (!conversionMetricId) {
    return res.status(200).json({
      error: 'Could not resolve a conversion metric. Set KLAVIYO_CONVERSION_METRIC_ID in Vercel, or grant the API key Metrics (Analytics) read access.',
      detail: metricErr,
    });
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
            ...(flowFilter ? { filter: `equals(flow_id,"${flowFilter}")` } : {}),
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

  // ---- 4a. Single-flow drill-down: per-message rows ----
  if (flowFilter) {
    // Sum report rows per message (across channels).
    const statsByMsg = {};
    results.forEach((row) => {
      const g = row.groupings || {};
      const mid = g.flow_message_id;
      if (!mid) return;
      const s = row.statistics || {};
      if (!statsByMsg[mid]) {
        statsByMsg[mid] = { recipients: 0, opens_unique: 0, clicks_unique: 0, conversions: 0, revenue: 0, channel: g.send_channel || '' };
      }
      const acc = statsByMsg[mid];
      acc.recipients += Number(s.recipients || 0);
      acc.opens_unique += Number(s.opens_unique || 0);
      acc.clicks_unique += Number(s.clicks_unique || 0);
      acc.conversions += Number(s.conversion_uniques || 0);
      acc.revenue += Number(s.conversion_value || 0);
    });

    // All message ids in a STABLE order: the flow's own message order first
    // (Email 1, 2, 3…), then any extra message that only appears in the report.
    const actionIds = await fetchFlowMessageIds(flowFilter, headers);
    const ids = Array.from(new Set([...actionIds, ...Object.keys(statsByMsg)]));

    // Resolve name + created for each message — in small batches with retries
    // so Klaviyo rate limits don't randomly blank out names.
    const infoById = {};
    const CHUNK = 4;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const arr = await Promise.all(chunk.map((mid) => fetchMessage(mid, headers)));
      chunk.forEach((mid, j) => { infoById[mid] = arr[j]; });
    }

    // Sort by the funnel order: earliest-created message first (Email 1, 2, 3…).
    const ordered = ids.slice().sort((a, b) => {
      const ca = (infoById[a] && infoById[a].created) || '';
      const cb = (infoById[b] && infoById[b].created) || '';
      if (ca && cb) return ca < cb ? -1 : (ca > cb ? 1 : 0);
      if (ca) return -1;
      if (cb) return 1;
      return 0;
    });

    const messages = ordered.map((mid, idx) => {
      const st = statsByMsg[mid] || { recipients: 0, opens_unique: 0, clicks_unique: 0, conversions: 0, revenue: 0, channel: '' };
      const rec = st.recipients || 0;
      return {
        message_id: mid,
        name: (infoById[mid] && infoById[mid].name) || ('Письмо ' + (idx + 1)),
        channel: st.channel || '',
        recipients: rec,
        open_rate: rec ? st.opens_unique / rec : 0,
        click_rate: rec ? st.clicks_unique / rec : 0,
        conversions: st.conversions || 0,
        revenue: st.revenue || 0,
      };
    });

    const meta = flowMap[flowFilter] || {};
    return res.status(200).json({
      timeframe,
      flow: { id: flowFilter, name: meta.name || flowFilter, status: meta.status || '' },
      messages,
    });
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

// The message ids of a flow, read from its actions' relationships (in flow
// order). Handles both singular/plural relationship keys.
async function fetchFlowMessageIds(flowId, headers) {
  const ids = [];
  try {
    let url = `${KLAVIYO_BASE}/flows/${flowId}/flow-actions/?page[size]=50`;
    for (let page = 0; page < 6 && url; page++) {
      const r = await fetch(url, { headers });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) break;
      (b.data || []).forEach((act) => {
        const rel = act.relationships || {};
        const m = rel['flow-messages'] || rel['flow-message'];
        if (m && m.data) {
          if (Array.isArray(m.data)) m.data.forEach((d) => { if (d && d.id) ids.push(d.id); });
          else if (m.data.id) ids.push(m.data.id);
        }
      });
      url = b.links && b.links.next ? b.links.next : null;
    }
  } catch (e) { /* best-effort — messages with stats still resolve by id */ }
  return ids;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// A flow message's { name, created }. Name falls back to the email subject.
// Retries on rate limits / transient errors so names don't randomly blank out.
async function fetchMessage(messageId, headers) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${KLAVIYO_BASE}/flow-messages/${messageId}/`, { headers });
      if (r.status === 429) { await sleep(400 * (attempt + 1)); continue; }
      if (!r.ok) return { name: '', created: '' };
      const b = await r.json().catch(() => ({}));
      const a = (b.data && b.data.attributes) || {};
      return {
        name: a.name || (a.content && a.content.subject) || '',
        created: a.created || a.created_at || '',
      };
    } catch (e) {
      await sleep(250 * (attempt + 1));
    }
  }
  return { name: '', created: '' };
}
