const JSZip = require('jszip');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // Handle CORS preflight
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

    // ── Step 1: Verify token & get channel ID ──────────────────────────────
    const channelRes = await fetch(
      'https://api.streamelements.com/kappa/v2/channels/me',
      { headers: seHeaders }
    );

    if (!channelRes.ok) {
      return respond(401, {
        error:
          'Token not recognised — double-check it was copied in full and try again.',
      });
    }

    const channel = await channelRes.json();
    const channelId = channel._id;

    // ── Step 2: Get list of overlays (no channel param — token scopes it) ──
    const overlaysRes = await fetch(
      'https://api.streamelements.com/kappa/v2/overlays',
      { headers: seHeaders }
    );

    if (!overlaysRes.ok) {
      const detail = await overlaysRes.text().catch(() => '');
      return respond(500, {
        error: `Couldn't fetch overlays (${overlaysRes.status}). ${detail}`.trim(),
      });
    }

    const overlaysList = await overlaysRes.json();

    if (!overlaysList || overlaysList.length === 0) {
      return respond(200, {
        assets: [],
        message: 'No overlays found on your account.',
      });
    }

    // ── Step 3: Get full detail for each overlay & extract CDN URLs ─────────
    const assets = []; // { url, filename, overlayName }
    const seenUrls = new Set();

    for (const overlay of overlaysList) {
      const detailRes = await fetch(
        `https://api.streamelements.com/kappa/v2/overlays/${overlay._id}`,
        { headers: seHeaders }
      );

      if (!detailRes.ok) continue;

      const detail = await detailRes.json();
      const overlayName =
        (detail.name || overlay.name || overlay._id)
          .replace(/[^a-zA-Z0-9 \-_]/g, '')
          .trim() || 'Overlay';

      const urls = extractCdnUrls(detail);

      for (const url of urls) {
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          // Grab just the filename from the URL path, strip query strings
          const rawName = url.split('/').pop().split('?')[0];
          const filename = rawName || 'asset';
          assets.push({ url, filename, overlayName });
        }
      }
    }

    if (assets.length === 0) {
      return respond(200, {
        assets: [],
        message:
          'No media files found in your overlays. They may use external links rather than uploaded files.',
      });
    }

    // ── Step 4a: ZIP mode — download everything server-side & bundle ────────
    if (mode === 'zip') {
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
          // Skip any file that fails to download
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

    // ── Step 4b: URL mode — return list of asset URLs for browser download ──
    return respond(200, { assets });

  } catch (err) {
    console.error('grab-assets error:', err);
    return respond(500, {
      error: 'Something went wrong on our end. Try again in a moment.',
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

// Recursively walk any object/array and collect all StreamElements CDN URLs
function extractCdnUrls(obj, found = new Set()) {
  if (typeof obj === 'string') {
    if (
      obj.startsWith('http') &&
      obj.includes('cdn.streamelements.com')
    ) {
      found.add(obj);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) extractCdnUrls(item, found);
  } else if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj)) extractCdnUrls(val, found);
  }
  return found;
}
