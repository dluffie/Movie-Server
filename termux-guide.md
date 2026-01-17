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
