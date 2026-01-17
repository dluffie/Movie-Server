import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

// This helps prevent Next.js from complaining about body reading, though App Router handles streams natively.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    // 1. Validate Headers
    const titleHeader = req.headers.get('X-Upload-Title')
    const descHeader = req.headers.get('X-Upload-Desc')

    if (!titleHeader) {
      return NextResponse.json({ error: 'Missing Title Header' }, { status: 400 })
    }

    const title = decodeURIComponent(titleHeader)
    const description = descHeader ? decodeURIComponent(descHeader) : ''

    // 2. Validate Body
    if (!req.body) {
      return NextResponse.json({ error: 'Missing file body' }, { status: 400 })
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const uploadDir = path.resolve('./movies', slug)

    // 3. Create Directory
    await mkdir(uploadDir, { recursive: true })

    // 4. Stream File to Disk (Low RAM usage)
    const inputPath = path.join(uploadDir, 'input.mp4')
    const writer = createWriteStream(inputPath)

    // Convert Web Stream to Node Stream for pipeline
    // @ts-ignore
    const nodeStream = Readable.fromWeb(req.body)

    // Write file
    await pipeline(nodeStream, writer)

    // 5. Save Metadata
    const metadata = {
      title,
      slug,
      description,
      duration: 'Unknown'
    }
    await writeFile(path.join(uploadDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

    // 6. Generate Thumbnail (Fast)
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .on('end', () => {
            console.log(`Poster generated for ${slug}`)
            resolve(true)
          })
          .on('error', (err) => {
            console.error(`Poster generation failed for ${slug}:`, err)
            reject(err)
          })
          .screenshots({
            count: 1,
            folder: uploadDir,
            filename: 'poster.jpg',
            timestamps: ['10%'],
            size: '320x?'
          })
      })
    } catch (e) {
      console.error("Non-fatal error generating poster:", e)
    }

    // 7. Start HLS Conversion (Background, Low Priority)
    const hlsPath = path.join(uploadDir, 'movie.m3u8')
    const statusPath = path.join(uploadDir, 'status.json')

    // Initial status
    await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0 }))

    console.log(`Starting HLS conversion for ${slug}...`)

    // Use fluent-ffmpeg for better control and progress tracking
    ffmpeg(inputPath)
      .outputOptions([
        '-threads 1', // Critical for Termux
        '-preset ultrafast',
        '-codec:v h264',
        '-codec:a aac',
        '-hls_time 6',
        '-hls_playlist_type vod'
      ])
      .output(hlsPath)
      .on('progress', (progress) => {
        // progress.percent is a number 0-100
        if (progress.percent) {
          const percent = Math.round(progress.percent)
          // Write status (fire and forget, don't await to avoid blocking)
          writeFile(statusPath, JSON.stringify({ status: 'processing', progress: percent })).catch(() => { })
        }
      })
      .on('end', () => {
        console.log(`FFmpeg HLS finished for ${slug}`)
        writeFile(statusPath, JSON.stringify({ status: 'ready', progress: 100 })).catch(() => { })
      })
      .on('error', (err) => {
        console.error(`FFmpeg HLS error for ${slug}:`, err)
        writeFile(statusPath, JSON.stringify({ status: 'error', error: err.message })).catch(() => { })
      })
      .run()

    return NextResponse.json({ success: true, slug, message: 'Upload received and poster generated.' })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
