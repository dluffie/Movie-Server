# Termux Setup Guide - LOCFLIX

## Prerequisites
```bash
pkg install nodejs ffmpeg
```

## First Time Setup
```bash
cd ~/Movie-Server
npm install
```

## Starting the Server (RECOMMENDED)

**Use production mode** — dev mode uses too much RAM and will crash on 2GB devices.

```bash
# Option 1: Use the startup script
bash start.sh

# Option 2: Manual build + start
npm run build
npm run start:prod
```

This will:
1. Build the production bundle (one-time, ~2-3 min)
2. Start the server with 256MB memory limit
3. Listen on `http://0.0.0.0:3000`

## ⚠️ DO NOT use `npm run dev` on low-RAM devices!
The dev server runs webpack HMR which uses 500MB+ RAM and will cause OOM kills.

## No Nginx Required!
All video streaming is now handled directly by Next.js.
You do NOT need to set up Nginx anymore.

## Usage
1. Open `http://<phone-ip>:3000` on any device on the same WiFi
2. Upload movies via the Upload page
3. Wait for conversion to complete
4. Play movies - stream integrity is verified automatically
