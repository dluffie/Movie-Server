import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
    const inputPath = path.join(uploadDir, 'input.mp4') // Always save as input.mp4 for simplicity or keep ext
    await writeFile(inputPath, buffer)

    // Save metadata
    const metadata = {
      title,
      slug,
      description: description || '',
      duration: 'Unknown' // Ideally parse this from ffmpeg
    }
    await writeFile(path.join(uploadDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

    // Start FFmpeg conversion (Detached process or await? User wants "correct", await might timeout on serverless but this is local Node)
    // We will await it to ensure it works, or maybe just fire and forget if it's long. 
    // For a local app, firing and returning "Processing started" is better UI, but "await" is simpler to debug.
    // Given the "Network Error" user faced, maybe their phone killed the process?
    // Let's try to run it.
    
    const hlsPath = path.join(uploadDir, 'movie.m3u8')
    const command = `ffmpeg -i "${inputPath}" -codec:v h264 -codec:a aac -hls_time 6 -hls_playlist_type vod "${hlsPath}"`
    
    // We will not await the ffmpeg command fully if it takes too long, next.js might timeout the request.
    // However, on a local "npm run dev" server, default timeout is high or infinite? 
    // Vercel has 10s limit. Local Node has no strict limit usually unless configured.
    // I'll execute it asynchronously without awaiting for the RESPONSE, but I'll log it.
    // Actually, to update the user on "done", we should ideally await. But video conversion takes minutes.
    // I will return success immediately after starting the process.
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`FFmpeg error for ${slug}:`, error)
      } else {
        console.log(`FFmpeg finished for ${slug}`)
        // Optional: Update metadata with duration or status?
        // Generate poster?
        // Let's try to generate a poster too.
        exec(`ffmpeg -i "${inputPath}" -ss 00:00:05 -vframes 1 "${path.join(uploadDir, 'poster.jpg')}"`)
      }
    })

    return NextResponse.json({ success: true, slug, message: 'Upload received, processing started.' })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
