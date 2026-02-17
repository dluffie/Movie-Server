# Termux Setup Guide - LOCFLIX

## Prerequisites
```bash
pkg install nodejs git
```

**FFmpeg is only needed if you upload movies directly on the phone.**
```bash
pkg install ffmpeg
```

## Setup on Termux
```bash
git clone <your-repo-url> ~/Movie-Server
cd ~/Movie-Server
npm install --production
```

## Starting the Server

```bash
cd ~/Movie-Server
bash start.sh
```

This uses the **pre-built standalone server** (built on your PC) — it uses only ~80MB RAM.

## ⚠️ IMPORTANT: Build on your PC, not on Termux!

Your phone (2GB RAM) cannot run `next build` — it will crash.

**Workflow:**
1. Make code changes on your **Windows PC**
2. Run `npm run build` on your **PC**
3. Commit and push: `git add -A && git commit -m "update" && git push`
4. On Termux: `cd ~/Movie-Server && git pull && bash start.sh`

## No Nginx Required!
All video streaming is handled directly by Next.js on port 3000.

## Usage
1. Open `http://<phone-ip>:3000` on any device on the same WiFi
2. Upload movies via the Upload page
3. Wait for conversion to complete
4. Play movies — stream integrity is verified automatically
