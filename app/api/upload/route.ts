import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile, stat, unlink, readdir, readFile } from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

// This helps prevent Next.js from complaining about body reading, though App Router handles streams natively.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const lockFile = path.resolve('./processing.lock')

  try {
    // 0. Check Processing Lock
    try {
      await stat(lockFile)
      // If stat succeeds, file exists -> BUSY
      return NextResponse.json({ error: 'Server is busy processing another video. Please wait.' }, { status: 429 })
    } catch (e) {
      // File does not exist -> Free to proceed
    }

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

    // CREATE LOCK
    await writeFile(lockFile, JSON.stringify({ title, startTime: Date.now() }))

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
    try {
      await pipeline(nodeStream, writer)
    } catch (writeErr) {
      // If upload fails, clear lock
      await unlink(lockFile).catch(() => { })
      throw writeErr
    }

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
            // Don't reject, poster is optional
            resolve(false)
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

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    const runChunkedConversion = async (mode: 'semi-turbo' | 'safe') => {
      console.log(`Starting CHUNKED conversion in ${mode} mode for ${slug}`)

      try {
        // 1. Split into 5-min chunks (Instant Copy)
        const segmentPattern = path.join(uploadDir, 'chunk_%03d.mp4')
        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions(['-c copy', '-map 0', '-segment_time 300', '-f segment', '-reset_timestamps 1'])
            .output(segmentPattern)
            .on('end', resolve)
            .on('error', reject)
            .run()
        })

        // 2. Process each chunk
        // We need to find how many chunks were created
        const chunks = (await readdir(uploadDir)).filter(f => f.startsWith('chunk_') && f.endsWith('.mp4')).sort()

        let totalChunks = chunks.length
        console.log(`Split into ${totalChunks} chunks. Processing...`)

        for (let i = 0; i < totalChunks; i++) {
          const chunkName = chunks[i]
          const chunkInput = path.join(uploadDir, chunkName)
          const chunkHls = path.join(uploadDir, `out_${i}.m3u8`)

          // Update Status
          const overallProgress = Math.round((i / totalChunks) * 100)
          await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: overallProgress, mode: `${mode} (chunk ${i + 1}/${totalChunks})` }))

          // Cool down
          await sleep(1000)

          // Convert Chunk
          await new Promise((resolve, reject) => {
            // Define options based on mode
            let outputOptions: string[] = []

            if (mode === 'semi-turbo') {
              outputOptions = ['-c:v copy', '-c:a aac', '-hls_time 6', '-hls_playlist_type vod', '-hls_segment_filename', path.join(uploadDir, `file_${i}_%03d.ts`)]
            } else {
              outputOptions = ['-threads 1', '-preset ultrafast', '-codec:v h264', '-codec:a aac', '-hls_time 6', '-hls_playlist_type vod', '-hls_segment_filename', path.join(uploadDir, `file_${i}_%03d.ts`)]
            }

            ffmpeg(chunkInput)
              .outputOptions(outputOptions)
              .output(chunkHls)
              .on('end', resolve)
              .on('error', (err) => {
                // If semi-turbo fails, we should technically fall back to safe for THIS chunk, 
                // but to keep it simple, if semi-turbo fails anywhere, we abort to full safe?
                // actually, let's just reject and let the outer catch switch to safe
                reject(err)
              })
              .run()
          })

          // Delete the intermediate chunk MP4 to save header/disk space immediately? 
          // Maybe keep until verifying? No, delete to save space on phone.
          await unlink(chunkInput).catch(() => { })
        }

        // 3. Merge Playlists (Actually, we just need to cat the segments or create a master playlist?
        // Simpler: Just concat the .ts files? No, header HLS is tricky.
        // HLS allows discontinuous segments. 
        // We need to manually stitch the .m3u8 files.
        // Simplified approach for now:
        // Since we are HLS, we can just list all the .ts files we generated in order in a new master m3u8.

        // This part is complex to get right manually. 
        // Alternative: Just run the main conversion but with -restart? No.

        // Let's rely on standard logic: 
        // If we are here, we successfully processed all chunks.
        // We need to generate the final movie.m3u8.
        // We can read all out_X.m3u8, extract #EXTINF lines, and combine them.

        let masterPlaylist = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:7\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n"

        for (let i = 0; i < totalChunks; i++) {
          const chunkContent = await readFile(path.join(uploadDir, `out_${i}.m3u8`), 'utf-8')
          const lines = chunkContent.split('\n')
          lines.forEach(line => {
            if (line.startsWith('#EXTINF') || line.endsWith('.ts')) {
              masterPlaylist += line + "\n"
            }
            if (line.startsWith('#EXT-X-DISCONTINUITY')) {
              masterPlaylist += line + "\n"
            }
          })
          // Add discontinuity between chunks to be safe if timestamps reset
          masterPlaylist += "#EXT-X-DISCONTINUITY\n"

          // Cleanup out_X.m3u8
          await unlink(path.join(uploadDir, `out_${i}.m3u8`)).catch(() => { })
        }

        masterPlaylist += "#EXT-X-ENDLIST"
        await writeFile(hlsPath, masterPlaylist)

        console.log(`Chunked conversion complete for ${slug}`)
        await writeFile(statusPath, JSON.stringify({ status: 'ready', progress: 100, mode })).catch(() => { })
        await unlink(lockFile).catch(() => { })

      } catch (e) {
        console.error(`Chunked ${mode} failed`, e)
        if (mode === 'semi-turbo') {
          await runChunkedConversion('safe')
        } else {
          await writeFile(statusPath, JSON.stringify({ status: 'error', error: 'Conversion failed' })).catch(() => { })
          await unlink(lockFile).catch(() => { })
        }
      }
    }

    const runConversion = (mode: 'turbo' | 'semi-turbo' | 'safe') => {
      console.log(`Attempting conversion in ${mode} mode for ${slug}`)

      if (mode !== 'turbo') {
        // If not turbo, use the memory-safe Chunked converter immediately
        runChunkedConversion(mode)
        return
      }

      // Turbo Logic (Same as before)
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v copy',
          '-c:a copy',
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
          unlink(lockFile).catch(() => console.error('Failed to clear lock'))
        })
        .on('error', (err) => {
          console.error(`FFmpeg error in ${mode} mode for ${slug}:`, err.message)

          if (mode === 'turbo') {
            console.log(`Turbo mode failed, switching to Semi-Turbo (Chunked) mode for ${slug}...`)
            writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode: 'semi-turbo' })).catch(() => { })
            // Switch to CHUNKED for safety
            runChunkedConversion('semi-turbo')
          }
        })
        .run()
    }

    // Start with Turbo mode
    // CRITICAL: We MUST delay initialization to allow Next.js to compile the status page.
    // If we start immediately, Next.js Compiler + FFmpeg = OOM Crash on Termux.
    console.log(`Scheduling conversion for ${slug} in 10 seconds...`)
    setTimeout(() => {
      runConversion('turbo')
    }, 10000) // 10s delay

    return NextResponse.json({ success: true, slug, message: 'Upload received. Conversion scheduled.' })

  } catch (error) {
    console.error('Upload error:', error)
    // Try to clear lock if generic error
    await unlink(path.resolve('./processing.lock')).catch(() => { })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
