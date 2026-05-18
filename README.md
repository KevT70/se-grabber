# se-ripper

A simple web tool for pulling alert sounds and video assets out of StreamElements. Paste your token, pick a download mode, done.

Built with Netlify Functions — no backend to manage, no database, nothing stored.

---

## What it does

Connects to the StreamElements API using your JWT token, walks through all your overlays, finds every media file hosted on the StreamElements CDN, and hands them back to you as either individual downloads or a single ZIP.

Your token is used only for the duration of the request and is never logged or stored anywhere.

---

## Download modes

**Download separately** (default)
The server finds all your asset URLs and returns them to the browser. Your browser then downloads each file one by one. No timeout risk. Recommended for most users.

**Bundle as ZIP**
The server downloads all the files itself, bundles them into a ZIP, and sends it back in one go. Faster and tidier, but may time out if you have a lot of large video files. If it fails, switch to "Download separately".

---

## Deployment

### Prerequisites
- A [Netlify](https://netlify.com) account
- A GitHub account

### Steps

1. Push this repo to GitHub
2. In your Netlify dashboard, go to **Add new site → Import from Git**
3. Select the `se-ripper` repo
4. Leave all build settings as-is — `netlify.toml` handles everything
5. Hit **Deploy**

Netlify will install dependencies and deploy the function automatically. No environment variables needed.

---

## Local development

```bash
npm install
npm install -g netlify-cli
netlify dev
```

Then open `http://localhost:8888` in your browser.

---

## Finding your StreamElements token

1. Log in at [streamelements.com](https://streamelements.com)
2. Click your profile picture (top right)
3. Go to **Account Settings → Channels**
4. Copy the **JWT Token** field

---

## Project structure

```
se-ripper/
├── netlify/
│   └── functions/
│       └── grab-assets.js   # Serverless function — talks to SE API
├── public/
│   ├── index.html           # The page the user sees
│   ├── style.css            # Styling
│   └── app.js               # Browser-side logic
├── netlify.toml             # Netlify config
└── package.json             # Dependencies (jszip)
```

---

## Limitations

- Only pulls files hosted on the StreamElements CDN (`cdn.streamelements.com`). Assets linked from external sources won't be included.
- ZIP mode has a ~10 second timeout on Netlify's free plan. Large asset sets should use "Download separately" instead.
- If the CDN blocks cross-origin requests in the browser, individual files will open in a new tab instead of downloading directly — right-click → Save As works fine in that case.

---

## Built with

- [Netlify Functions](https://docs.netlify.com/functions/overview/)
- [JSZip](https://stuk.github.io/jszip/)
- [StreamElements API](https://docs.streamelements.com/)
