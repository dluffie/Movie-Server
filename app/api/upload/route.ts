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
    await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode: 'turbo' }))

    console.log(`Starting HLS conversion for ${slug}...`)

    const runConversion = (mode: 'turbo' | 'safe') => {
      const isTurbo = mode === 'turbo'

      console.log(`Attempting conversion in ${mode} mode for ${slug}`)

      ffmpeg(inputPath)
        .outputOptions(isTurbo ? [
          '-c:v copy',
          '-c:a copy',
          '-hls_time 6',
          '-hls_playlist_type vod'
        ] : [
          '-threads 1',
          '-preset ultrafast',
          '-codec:v h264',
          '-codec:a aac',
          '-hls_time 6',
          '-hls_playlist_type vod'
        ])
        .output(hlsPath)
        .on('progress', (progress) => {
          if (progress.percent) {
            const percent = Math.round(progress.percent)
            writeFile(statusPath, JSON.stringify({ status: 'processing', progress: percent, mode })).catch(() => { })
          }
        })
        .on('end', () => {
          console.log(`FFmpeg HLS finished for ${slug} in ${mode} mode`)
          writeFile(statusPath, JSON.stringify({ status: 'ready', progress: 100, mode })).catch(() => { })
        })
        .on('error', (err) => {
          console.error(`FFmpeg error in ${mode} mode for ${slug}:`, err.message)

          if (isTurbo) {
            console.log(`Turbo mode failed, switching to Safe mode for ${slug}...`)
            // Update status and try safe mode
            writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode: 'safe' })).catch(() => { })
            runConversion('safe')
          } else {
            // Safe mode failed too, real error
            writeFile(statusPath, JSON.stringify({ status: 'error', error: err.message })).catch(() => { })
          }
        })
        .run()
    }

    // Start with Turbo mode
    runConversion('turbo')

    return NextResponse.json({ success: true, slug, message: 'Upload received. Conversion started.' })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
