# Termux Setup Guide

## 1. Install Dependencies
```bash
pkg update && pkg upgrade
pkg install nodejs ffmpeg nginx git
```

## 2. Setup Project
Inside the `Movie-Server` directory:
```bash
npm install
```

## 3. Configure Nginx
You need to edit the `nginx.conf` file to point to the correct path of your `movies` folder.
Check the provided `nginx.conf` in this directory. 
If your project is in `~/Movie-Server`, the alias `/data/data/com.termux/files/home/Movie-Server/movies/` should work.

To run Nginx with this config:
```bash
nginx -c $PWD/nginx.conf
```
*Note: You might need to kill existing nginx process first (`pkill nginx`).*

## 4. Run the App
```bash
npm run dev
```


The app will be available at `http://localhost:3000`.
Upload movies via `http://localhost:3000/upload`.
They will be transcoded and served via Nginx on port 8080.

## Troubleshooting

### Nginx "Address already in use"
If you see `bind() to 0.0.0.0:8080 failed`, it means Nginx is already running.
Run this to stop it, then try starting it again:
```bash
pkill nginx
nginx -c $PWD/nginx.conf
```

### Server Restarts on Upload
If the server restarts (shows "Compiling...") when you upload a movie, ensure your `next.config.ts` has the `watchOptions` to ignore the `movies` folder. This is critical for Termux stability.

### Stream Error (bufferAddCodecError)
This usually means the video file is corrupt because the conversion was interrupted. 
1. Delete the corrupt movie folder from `movies/`.
2. Ensure the server doesn't restart on upload.
3. Upload again.

