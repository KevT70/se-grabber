const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Known StreamElements asset domains — broadened to catch all variants
const SE_DOMAINS = [
  'cdn.streamelements.com',
  'static.streamelements.com',
  'uploads.streamelements.com',
  'streamelements.com',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { token } = JSON.parse(event.body || '{}');

    if (!token) {
      return respond(400, { error: 'No token provided.' });
    }

    const seHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };

    // ── Step 1: Verify token & get channel ID ──────────────────────────────
    console.log('[se-ripper] Step 1: Fetching channel info...');

    let channelRes;
    try {
      channelRes = await fetch(
        'https://api.streamelements.com/kappa/v2/channels/me',
        { headers: seHeaders }
      );
    } catch (err) {
      return respond(500, { error: `Network error reaching StreamElements: ${err.message}` });
    }

    if (!channelRes.ok) {
      return respond(401, {
        error: 'Token not recognised — double-check it was copied in full and try again.',
      });
    }

    const channel = await channelRes.json();
    const channelId = channel._id;
    console.log('[se-ripper] Channel ID:', channelId);

    if (!channelId) {
      return respond(500, {
        error: `Got a channel response but couldn't find an ID. Keys returned: ${Object.keys(channel).join(', ')}`,
      });
    }

    // ── Step 2: Get overlays list ──────────────────────────────────────────
    console.log('[se-ripper] Step 2: Fetching overlays...');

    let overlaysRes;
    try {
      overlaysRes = await fetch(
        `https://api.streamelements.com/kappa/v2/overlays/${channelId}`,
        { headers: seHeaders }
      );
    } catch (err) {
      return respond(500, { error: `Network error fetching overlays: ${err.message}` });
    }

    if (!overlaysRes.ok) {
      const detail = await overlaysRes.text().catch(() => '');
      return respond(500, {
        error: `Couldn't fetch overlays (${overlaysRes.status}). ${detail}`.trim(),
      });
    }

    const overlaysRaw = await overlaysRes.json();
    const overlaysList = Array.isArray(overlaysRaw)
      ? overlaysRaw
      : overlaysRaw.docs || overlaysRaw.data || overlaysRaw.overlays || [];

    console.log('[se-ripper] Overlays found:', overlaysList.length);

    if (overlaysList.length === 0) {
      return respond(200, { assets: [], message: 'No overlays found on your account.' });
    }

    // ── Step 3: Get full detail for each overlay & extract CDN URLs ─────────
    const assets = [];
    const seenUrls = new Set();
    const allDomainsFound = new Set(); // for diagnostics

    for (const overlay of overlaysList) {
      const overlayId = overlay._id || overlay.id;
      if (!overlayId) continue;

      let detailRes;
      try {
        detailRes = await fetch(
          `https://api.streamelements.com/kappa/v2/overlays/${overlayId}`,
          { headers: seHeaders }
        );
      } catch {
        continue;
      }

      if (!detailRes.ok) continue;

      const detail = await detailRes.json();
      const overlayName =
        (detail.name || overlay.name || overlayId)
          .replace(/[^a-zA-Z0-9 \-_]/g, '')
          .trim() || 'Overlay';

      // Collect all HTTP URLs for diagnostics, and SE-domain URLs for assets
      const { matched, allDomains } = extractUrls(detail);
      allDomains.forEach((d) => allDomainsFound.add(d));

      console.log(`[se-ripper] Overlay "${overlayName}": ${matched.size} asset URLs found. All domains:`, [...allDomains]);

      for (const url of matched) {
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          const rawName = url.split('/').pop().split('?')[0];
          assets.push({ url, filename: rawName || 'asset', overlayName });
        }
      }
    }

    console.log('[se-ripper] Total assets found:', assets.length);
    console.log('[se-ripper] All domains seen across all overlays:', [...allDomainsFound]);

    if (assets.length === 0) {
      return respond(200, {
        assets: [],
        message: `No media files found. Domains seen in your overlays: ${[...allDomainsFound].join(', ') || 'none'}`,
      });
    }

    return respond(200, { assets });

  } catch (err) {
    console.error('[se-ripper] Unhandled error:', err.message, err.stack);
    return respond(500, { error: `Unexpected error: ${err.message}` });
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────

function respond(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Walk any object/array, collect all HTTP URLs and flag SE-domain ones
function extractUrls(obj, matched = new Set(), allDomains = new Set()) {
  if (typeof obj === 'string') {
    if (obj.startsWith('http')) {
      try {
        const hostname = new URL(obj).hostname;
        allDomains.add(hostname);
        if (SE_DOMAINS.some((d) => obj.includes(d))) {
          matched.add(obj);
        }
      } catch {
        // not a valid URL, skip
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) extractUrls(item, matched, allDomains);
  } else if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj)) extractUrls(val, matched, allDomains);
  }
  return { matched, allDomains };
}
