/* ── Elements ─────────────────────────────────────────────────── */
const tokenInput  = document.getElementById('token');
const helpToggle  = document.getElementById('help-toggle');
const tokenHelp   = document.getElementById('token-help');
const modeToggle  = document.getElementById('mode-toggle');
const labelSep    = document.getElementById('label-separate');
const labelZip    = document.getElementById('label-zip');
const modeHint    = document.getElementById('mode-hint');
const grabBtn     = document.getElementById('grab-btn');
const btnText     = grabBtn.querySelector('.btn-text');
const btnSpinner  = grabBtn.querySelector('.btn-spinner');
const statusEl    = document.getElementById('status');
const resultsEl   = document.getElementById('results');

const MODE_HINTS = {
  separate: 'Your browser downloads each file one by one. Works every time, no fuss.',
  zip:      'All your files get bundled into a single ZIP in your browser. Nothing goes through a server — works on any size library.',
};

/* ── Token help toggle ────────────────────────────────────────── */
helpToggle.addEventListener('click', () => {
  const isHidden = tokenHelp.hidden;
  tokenHelp.hidden = !isHidden;
  helpToggle.textContent = isHidden ? 'Hide instructions ↑' : 'Where do I find this? ↓';
});

/* ── Mode toggle ──────────────────────────────────────────────── */
modeToggle.addEventListener('change', updateModeUI);
updateModeUI();

function updateModeUI() {
  const isZip = modeToggle.checked;
  labelSep.classList.toggle('active', !isZip);
  labelZip.classList.toggle('active', isZip);
  modeHint.textContent = isZip ? MODE_HINTS.zip : MODE_HINTS.separate;
}

/* ── Main grab handler ────────────────────────────────────────── */
grabBtn.addEventListener('click', handleGrab);

async function handleGrab() {
  const token = tokenInput.value.trim();

  if (!token) {
    showStatus('Paste your StreamElements token in the box above first.', 'error');
    tokenInput.focus();
    return;
  }

  const isZip = modeToggle.checked;

  setLoading(true);
  showStatus('Connecting to StreamElements…', 'info');
  resultsEl.innerHTML = '';

  try {
    // ── Always fetch the asset URL list from the function ──────
    const res = await fetch('/.netlify/functions/grab-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong. Try again.');
    }

    if (!data.assets || data.assets.length === 0) {
      showStatus(data.message || 'No media assets found in your overlays.', 'info');
      setLoading(false);
      return;
    }

    // ── ZIP mode: build the ZIP in the browser ─────────────────
    if (isZip) {
      await buildAndDownloadZip(data.assets);
      return;
    }

    // ── Separate mode: show download list ──────────────────────
    showStatus(
      `Found ${data.assets.length} file${data.assets.length !== 1 ? 's' : ''} — ready to download.`,
      'success'
    );
    showUrlList(data.assets);

  } catch (err) {
    showStatus(err.message || 'Something went wrong. Try again.', 'error');
  } finally {
    setLoading(false);
  }
}

/* ── Client-side ZIP builder ──────────────────────────────────── */
async function buildAndDownloadZip(assets) {
  const zip = new JSZip();
  let downloaded = 0;
  let failed = 0;

  showStatus(`Downloading files… 0 / ${assets.length}`, 'info');

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    try {
      const res = await fetch(asset.url, { mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        const safeFolderName = asset.overlayName.replace(/[^a-zA-Z0-9\-_]/g, '_');
        zip.file(`${safeFolderName}/${asset.filename}`, blob);
        downloaded++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    showStatus(
      `Downloading files… ${i + 1} / ${assets.length}`,
      'info'
    );
  }

  if (downloaded === 0) {
    showStatus(
      'Couldn\'t download any files directly — try "Download separately" instead.',
      'error'
    );
    return;
  }

  showStatus('Building your ZIP…', 'info');

  const zipBlob = await zip.generateAsync(
    { type: 'blob' },
    (metadata) => {
      showStatus(`Building your ZIP… ${Math.round(metadata.percent)}%`, 'info');
    }
  );

  triggerBlobDownload(zipBlob, 'se-assets.zip');

  const msg = failed > 0
    ? `Done! ZIP downloaded. ${failed} file${failed !== 1 ? 's' : ''} couldn't be fetched and were skipped.`
    : `Done! All ${downloaded} file${downloaded !== 1 ? 's' : ''} bundled and downloaded.`;

  showStatus(msg, 'success');
  showZipReady(zipBlob);
}

/* ── UI helpers ───────────────────────────────────────────────── */
function setLoading(on) {
  grabBtn.disabled  = on;
  btnText.hidden    = on;
  btnSpinner.hidden = !on;
}

function showStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className   = `status ${type}`;
  statusEl.hidden      = false;
}

/* ── ZIP ready block ──────────────────────────────────────────── */
function showZipReady(blob) {
  const div = document.createElement('div');
  div.className = 'zip-ready';
  div.innerHTML = `
    <p>If the download didn't start automatically, click below:</p>
    <button class="dl-btn" type="button">⬇ Download ZIP Again</button>
  `;
  div.querySelector('.dl-btn').addEventListener('click', () => {
    triggerBlobDownload(blob, 'se-assets.zip');
  });
  resultsEl.innerHTML = '';
  resultsEl.appendChild(div);
}

/* ── URL list ─────────────────────────────────────────────────── */
function showUrlList(assets) {
  const groups = {};
  for (const asset of assets) {
    const key = asset.overlayName || 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(asset);
  }

  const wrap = document.createElement('div');
  wrap.className = 'url-list';

  const header = document.createElement('div');
  header.className = 'url-list-header';
  header.innerHTML = `
    <p>${assets.length} file${assets.length !== 1 ? 's' : ''} found across ${Object.keys(groups).length} overlay${Object.keys(groups).length !== 1 ? 's' : ''}</p>
  `;
  const dlAllBtn = document.createElement('button');
  dlAllBtn.className = 'dl-all-btn';
  dlAllBtn.textContent = `⬇ Download All (${assets.length})`;
  dlAllBtn.addEventListener('click', () => downloadAll(assets, dlAllBtn));
  header.appendChild(dlAllBtn);
  wrap.appendChild(header);

  for (const [name, items] of Object.entries(groups)) {
    const group = document.createElement('div');
    group.className = 'overlay-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'overlay-group-header';
    groupHeader.textContent = name;
    group.appendChild(groupHeader);

    const ul = document.createElement('ul');

    for (const item of items) {
      const li = document.createElement('li');
      li.dataset.url = item.url;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.filename;
      nameSpan.title = item.filename;

      const btn = document.createElement('button');
      btn.className = 'file-dl-btn';
      btn.textContent = 'Save';
      btn.addEventListener('click', () => downloadSingle(item, btn));

      li.appendChild(nameSpan);
      li.appendChild(btn);
      ul.appendChild(li);
    }

    group.appendChild(ul);
    wrap.appendChild(group);
  }

  resultsEl.innerHTML = '';
  resultsEl.appendChild(wrap);
}

/* ── Download helpers ─────────────────────────────────────────── */
async function downloadSingle(asset, btn) {
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  const ok = await fetchAndDownload(asset.url, asset.filename);

  if (btn) {
    if (ok) {
      btn.textContent = '✓';
      btn.classList.add('done');
    } else {
      window.open(asset.url, '_blank');
      btn.textContent = 'Opened ↗';
      btn.classList.add('done');
    }
  }
}

async function downloadAll(assets, btn) {
  btn.disabled = true;

  for (let i = 0; i < assets.length; i++) {
    btn.textContent = `Downloading… ${i + 1} / ${assets.length}`;

    const row = resultsEl.querySelector(`li[data-url="${CSS.escape(assets[i].url)}"]`);
    const rowBtn = row ? row.querySelector('.file-dl-btn') : null;

    const ok = await fetchAndDownload(assets[i].url, assets[i].filename);
    if (!ok) window.open(assets[i].url, '_blank');

    if (rowBtn && !rowBtn.classList.contains('done')) {
      rowBtn.textContent = ok ? '✓' : 'Opened ↗';
      rowBtn.classList.add('done');
      rowBtn.disabled = true;
    }

    if (i < assets.length - 1) await sleep(700);
  }

  btn.textContent = '✓ All Done';
  setTimeout(() => {
    btn.textContent = `⬇ Download All (${assets.length})`;
    btn.disabled = false;
  }, 3000);
}

async function fetchAndDownload(url, filename) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    triggerBlobDownload(blob, filename);
    return true;
  } catch {
    return false;
  }
}

function triggerBlobDownload(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
