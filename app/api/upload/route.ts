import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const title = formData.get('title') as string
    const description = formData.get('description') as string

    if (!file || !title) {
      return NextResponse.json({ error: 'Missing file or title' }, { status: 400 })
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const uploadDir = path.resolve('./movies', slug)

    // Create directory
    await mkdir(uploadDir, { recursive: true })

    // Save input file
    const buffer = Buffer.from(await file.arrayBuffer())
    const inputPath = path.join(uploadDir, 'input.mp4')
    await writeFile(inputPath, buffer)

    // Save metadata
    const metadata = {
      title,
      slug,
      description: description || '',
      duration: 'Unknown'
    }
    await writeFile(path.join(uploadDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

    // Generate Poster immediately using fluent-ffmpeg
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
            timestamps: ['10%'], // Take a screenshot at 10% of the video duration
            size: '320x?' // Optional: resize to width 320, maintain aspect ratio
          })
      })
    } catch (e) {
      console.error("Non-fatal error generating poster:", e)
      // Continue even if poster fails, use fallback UI
    }

    // Start FFmpeg HLS conversion in background (fire and forget)
    const hlsPath = path.join(uploadDir, 'movie.m3u8')
    const command = `ffmpeg -i "${inputPath}" -codec:v h264 -codec:a aac -hls_time 6 -hls_playlist_type vod "${hlsPath}"`

    console.log(`Starting HLS conversion for ${slug}...`)
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`FFmpeg HLS error for ${slug}:`, error)
      } else {
        console.log(`FFmpeg HLS finished for ${slug}`)
      }
    })

    return NextResponse.json({ success: true, slug, message: 'Upload received, poster generated, processing video.' })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
