/* ── Elements ─────────────────────────────────────────────────── */
const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('file-input');
const browseBtn   = document.getElementById('browse-btn');
const dropContent = document.getElementById('drop-content');
const fileSelected = document.getElementById('file-selected');
const fileNameEl  = document.getElementById('file-name');
const fileClear   = document.getElementById('file-clear');
const helpToggle  = document.getElementById('help-toggle');
const helpBox     = document.getElementById('help-box');
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
  zip:      'All your files get bundled into a single ZIP right in your browser. Nothing goes through a server.',
};

// Known StreamElements asset domains
const SE_DOMAINS = [
  'cdn.streamelements.com',
  'static.streamelements.com',
  'uploads.streamelements.com',
  'streamelements.com',
];

let loadedFile = null; // holds the parsed JSON once uploaded

/* ── File drop / browse ───────────────────────────────────────── */
browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', (e) => {
  if (e.target === dropZone || e.target === dropContent) fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileClear.addEventListener('click', (e) => {
  e.stopPropagation();
  clearFile();
});

function handleFile(file) {
  if (!file.name.endsWith('.json')) {
    showStatus('Please upload a .json file exported from StreamElements.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      loadedFile = JSON.parse(e.target.result);
      showFileSelected(file.name);
      hideStatus();
      resultsEl.innerHTML = '';
    } catch {
      showStatus('That file doesn\'t look like valid JSON. Try exporting again from StreamElements.', 'error');
      clearFile();
    }
  };
  reader.readAsText(file);
}

function showFileSelected(name) {
  fileNameEl.textContent = name;
  dropContent.hidden = true;
  fileSelected.hidden = false;
  dropZone.classList.add('has-file');
}

function clearFile() {
  loadedFile = null;
  fileInput.value = '';
  dropContent.hidden = false;
  fileSelected.hidden = true;
  dropZone.classList.remove('has-file');
  hideStatus();
  resultsEl.innerHTML = '';
}

/* ── Help toggle ──────────────────────────────────────────────── */
helpToggle.addEventListener('click', () => {
  const isHidden = helpBox.hidden;
  helpBox.hidden = !isHidden;
  helpToggle.textContent = isHidden ? 'Hide instructions ↑' : 'How do I export my overlay? ↓';
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
  if (!loadedFile) {
    showStatus('Upload your overlay JSON file first (Step 1).', 'error');
    return;
  }

  const isZip = modeToggle.checked;

  setLoading(true);
  showStatus('Reading your overlay file…', 'info');
  resultsEl.innerHTML = '';

  try {
    // Extract all SE CDN URLs from the JSON
    const { matched, allDomains } = extractUrls(loadedFile);
    const assets = buildAssetList(matched, loadedFile);

    if (assets.length === 0) {
      const domains = [...allDomains].filter(d => !d.includes('google') && !d.includes('jquery'));
      showStatus(
        domains.length > 0
          ? `No media files found. Other domains spotted: ${domains.join(', ')}`
          : 'No media files found in this overlay export.',
        'info'
      );
      setLoading(false);
      return;
    }

    if (isZip) {
      await buildAndDownloadZip(assets);
    } else {
      showStatus(
        `Found ${assets.length} file${assets.length !== 1 ? 's' : ''} — ready to download.`,
        'success'
      );
      showUrlList(assets);
    }

  } catch (err) {
    showStatus(`Something went wrong: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

/* ── URL extraction (runs entirely in browser) ────────────────── */
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
        // not a valid URL
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) extractUrls(item, matched, allDomains);
  } else if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj)) extractUrls(val, matched, allDomains);
  }
  return { matched, allDomains };
}

// Turn a Set of URLs into a tidy asset list with filenames and overlay name
function buildAssetList(urlSet, json) {
  const overlayName = (json.name || json.overlay_name || 'Overlay')
    .replace(/[^a-zA-Z0-9 \-_]/g, '')
    .trim() || 'Overlay';

  return [...urlSet].map((url) => ({
    url,
    filename: url.split('/').pop().split('?')[0] || 'asset',
    overlayName,
  }));
}

/* ── Client-side ZIP builder ──────────────────────────────────── */
async function buildAndDownloadZip(assets) {
  const zip = new JSZip();
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < assets.length; i++) {
    showStatus(`Downloading files… ${i + 1} / ${assets.length}`, 'info');
    const asset = assets[i];
    try {
      const res = await fetch(asset.url, { mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        const safeName = asset.overlayName.replace(/[^a-zA-Z0-9\-_]/g, '_');
        zip.file(`${safeName}/${asset.filename}`, blob);
        downloaded++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
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
    (meta) => showStatus(`Building your ZIP… ${Math.round(meta.percent)}%`, 'info')
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

function hideStatus() {
  statusEl.hidden = true;
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
  header.innerHTML = `<p>${assets.length} file${assets.length !== 1 ? 's' : ''} found</p>`;

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
    btn.textContent = ok ? '✓' : 'Opened ↗';
    btn.classList.add('done');
    if (!ok) window.open(asset.url, '_blank');
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
    if (!res.ok) throw new Error();
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
