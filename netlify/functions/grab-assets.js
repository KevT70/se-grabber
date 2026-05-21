const JSZip = require('jszip');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
    const { token, mode } = JSON.parse(event.body || '{}');

    if (!token) {
      return respond(400, { error: 'No token provided.' });
    }

    const seHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };

    // ── Step 1: Verify token & get channel ─────────────────────────────────
    console.log('[se-ripper] Step 1: Fetching channel info...');

    let channelRes;
    try {
      channelRes = await fetch(
        'https://api.streamelements.com/kappa/v2/channels/me',
        { headers: seHeaders }
      );
    } catch (err) {
      console.error('[se-ripper] Step 1 fetch threw:', err.message);
      return respond(500, { error: `Network error reaching StreamElements: ${err.message}` });
    }

    console.log('[se-ripper] Step 1 status:', channelRes.status);

    if (!channelRes.ok) {
      const body = await channelRes.text().catch(() => '');
      console.error('[se-ripper] Step 1 failed:', channelRes.status, body);
      return respond(401, {
        error: 'Token not recognised — double-check it was copied in full and try again.',
      });
    }

    const channel = await channelRes.json();
    console.log('[se-ripper] Step 1 channel keys:', Object.keys(channel));

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
      console.error('[se-ripper] Step 2 fetch threw:', err.message);
      return respond(500, { error: `Network error fetching overlays: ${err.message}` });
    }

    console.log('[se-ripper] Step 2 status:', overlaysRes.status);

    if (!overlaysRes.ok) {
      const detail = await overlaysRes.text().catch(() => '');
      console.error('[se-ripper] Step 2 failed:', overlaysRes.status, detail);
      return respond(500, {
        error: `Couldn't fetch overlays (${overlaysRes.status}). ${detail}`.trim(),
      });
    }

    const overlaysRaw = await overlaysRes.json();
    console.log('[se-ripper] Step 2 response type:', typeof overlaysRaw, Array.isArray(overlaysRaw) ? `array[${overlaysRaw.length}]` : Object.keys(overlaysRaw));

    // SE might return { docs: [...] } or a plain array — handle both
    const overlaysList = Array.isArray(overlaysRaw)
      ? overlaysRaw
      : overlaysRaw.docs || overlaysRaw.data || overlaysRaw.overlays || [];

    console.log('[se-ripper] Overlays found:', overlaysList.length);

    if (overlaysList.length === 0) {
      return respond(200, {
        assets: [],
        message: 'No overlays found on your account.',
      });
    }

    // ── Step 3: Get full detail for each overlay & extract CDN URLs ─────────
    console.log('[se-ripper] Step 3: Fetching overlay details...');

    const assets = [];
    const seenUrls = new Set();

    for (const overlay of overlaysList) {
      const overlayId = overlay._id || overlay.id;
      if (!overlayId) {
        console.warn('[se-ripper] Overlay missing ID, skipping:', overlay);
        continue;
      }

      console.log('[se-ripper] Fetching overlay:', overlayId);

      let detailRes;
      try {
        detailRes = await fetch(
          `https://api.streamelements.com/kappa/v2/overlays/${overlayId}`,
          { headers: seHeaders }
        );
      } catch (err) {
        console.warn('[se-ripper] Overlay detail fetch threw:', overlayId, err.message);
        continue;
      }

      if (!detailRes.ok) {
        console.warn('[se-ripper] Overlay detail failed:', overlayId, detailRes.status);
        continue;
      }

      const detail = await detailRes.json();
      const overlayName =
        (detail.name || overlay.name || overlayId)
          .replace(/[^a-zA-Z0-9 \-_]/g, '')
          .trim() || 'Overlay';

      const urls = extractCdnUrls(detail);
      console.log(`[se-ripper] Overlay "${overlayName}" CDN URLs found:`, urls.size);

      for (const url of urls) {
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          const rawName = url.split('/').pop().split('?')[0];
          assets.push({ url, filename: rawName || 'asset', overlayName });
        }
      }
    }

    console.log('[se-ripper] Total assets found:', assets.length);

    if (assets.length === 0) {
      return respond(200, {
        assets: [],
        message: 'No media files found in your overlays. They may use external links rather than uploaded files.',
      });
    }

    // ── Step 4a: ZIP mode ──────────────────────────────────────────────────
    if (mode === 'zip') {
      console.log('[se-ripper] ZIP mode: downloading files...');
      const zip = new JSZip();

      for (const asset of assets) {
        try {
          const fileRes = await fetch(asset.url);
          if (fileRes.ok) {
            const buffer = await fileRes.arrayBuffer();
            const safeFolderName = asset.overlayName.replace(/[^a-zA-Z0-9\-_]/g, '_');
            zip.file(`${safeFolderName}/${asset.filename}`, buffer);
          }
        } catch {
          // Skip failed files
        }
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="se-assets.zip"',
        },
        body: zipBuffer.toString('base64'),
        isBase64Encoded: true,
      };
    }

    // ── Step 4b: URL mode ──────────────────────────────────────────────────
    return respond(200, { assets });

  } catch (err) {
    console.error('[se-ripper] Unhandled error:', err.message, err.stack);
    return respond(500, {
      error: `Unexpected error: ${err.message}`,
    });
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

function extractCdnUrls(obj, found = new Set()) {
  if (typeof obj === 'string') {
    if (obj.startsWith('http') && obj.includes('cdn.streamelements.com')) {
      found.add(obj);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) extractCdnUrls(item, found);
  } else if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj)) extractCdnUrls(val, found);
  }
  return found;
}
