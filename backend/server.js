import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'

const app = express()
app.use(cors())

const MOVIES = path.resolve('../movies')
const upload = multer({ dest: 'tmp/' })

app.get('/api/movies', (req, res) => {
  const movies = fs.readdirSync(MOVIES).map(slug => {
    const meta = JSON.parse(fs.readFileSync(path.join(MOVIES, slug, 'metadata.json')))
    return { ...meta }
  })
  res.json({ movies })
})

app.post('/api/upload', upload.single('file'), (req, res) => {
  const slug = req.body.title.toLowerCase().replace(/\s+/g, '-')
  const dir = path.join(MOVIES, slug)
  fs.mkdirSync(dir, { recursive: true })

  fs.renameSync(req.file.path, path.join(dir, 'input.mp4'))

  exec(
    `ffmpeg -i "${dir}/input.mp4" -hls_time 6 -hls_playlist_type vod "${dir}/movie.m3u8"`,
    () => res.json({ success: true })
  )
})

app.listen(4000, () => {
  console.log('Backend running on http://localhost:4000')
})
