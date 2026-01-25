import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile, stat, unlink, readdir, readFile } from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import ffmpeg from 'fluent-ffmpeg'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { promisify } from 'util'

// This helps prevent Next.js from complaining about body reading, though App Router handles streams natively.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const lockFile = path.resolve('./processing.lock')

  try {
    // 0. Check Processing Lock
    console.log(`Checking lock file at: ${lockFile}`)
    try {
      const lockStats = await stat(lockFile)

      // Check for Stale Lock (> 5 minutes) or Forced Upload
      const lockAgeMs = Date.now() - lockStats.mtimeMs
      const isStale = lockAgeMs > 5 * 60 * 1000 // 5 minutes
      const forceUpload = req.headers.get('X-Force-Upload') === 'true'

      if (isStale || forceUpload) {
        console.warn(`Removing ${isStale ? 'stale' : 'forced'} lock file: ${lockFile}`)
        await unlink(lockFile).catch(() => { })
      } else {
        // If stat succeeds and not stale/forced, file exists -> BUSY
        console.log(`Server is busy. Lock exists and is recent (Age: ${Math.round(lockAgeMs / 1000)}s).`)
        return NextResponse.json({ error: 'Server is busy processing another video. Please wait 5 minutes or restart server.' }, { status: 429 })
      }
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
    const skipPoster = req.headers.get('X-Skip-Poster-Gen') === 'true'

    if (!skipPoster) {
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
    } else {
      console.log(`Skipping poster generation for ${slug} (Custom poster provided)`)
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
        // 1. Split into 5-min chunks (Instant Copy) - Only video and audio, subs handled separately
        const segmentPattern = path.join(uploadDir, 'chunk_%03d.mp4')
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions([
              '-map 0:v:0',           // First video stream
              '-map 0:a',             // All audio streams
              '-c copy',              // Copy codec (fast)
              '-segment_time 300',    // 5 minute chunks
              '-f segment',
              '-reset_timestamps 1'
            ])
            .output(segmentPattern)
            .on('start', (cmd) => console.log(`Segmenting: ${cmd}`))
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
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
          await new Promise<void>((resolve, reject) => {
            // Define options based on mode
            let outputOptions: string[] = []

            if (mode === 'semi-turbo') {
              // COPY Video, Encode ALL Audio to AAC for HLS compatibility
              outputOptions = [
                '-map 0:v:0',         // First video stream
                '-map 0:a',           // All audio streams  
                '-c:v copy',          // Copy video
                '-c:a aac',           // Convert audio to AAC
                '-hls_time 6',
                '-hls_playlist_type vod',
                '-hls_segment_filename', path.join(uploadDir, `file_${i}_%03d.ts`)
              ]
            } else {
              // SAFE: Re-encode Everything
              outputOptions = [
                '-map 0:v:0',         // First video stream
                '-map 0:a',           // All audio streams
                '-threads 1',
                '-preset ultrafast',
                '-codec:v h264',
                '-codec:a aac',
                '-hls_time 6',
                '-hls_playlist_type vod',
                '-hls_segment_filename', path.join(uploadDir, `file_${i}_%03d.ts`)
              ]
            }

            ffmpeg(chunkInput)
              .outputOptions(outputOptions)
              .output(chunkHls)
              .on('start', (cmd) => console.log(`Chunk ${i} conversion: ${cmd}`))
              .on('end', () => resolve())
              .on('error', (err) => {
                console.error(`Chunk ${i} error:`, err.message)
                reject(err)
              })
              .run()
          })

          // Delete the intermediate chunk MP4
          await unlink(chunkInput).catch(() => { })
        }


        // 3. Merge Playlists
        let masterPlaylist = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:7\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n"

        for (let i = 0; i < totalChunks; i++) {
          const chunkContent = await readFile(path.join(uploadDir, `out_${i}.m3u8`), 'utf-8')
          const lines = chunkContent.split('\n')
          lines.forEach(line => {
            if (line.startsWith('#EXTINF')) {
              masterPlaylist += line + "\n"
            } else if (line.endsWith('.ts')) {
              // Fix: Remove absolute path prefix
              const relativeLine = line.replace(uploadDir + path.sep, '').replace(uploadDir + '/', '')
              masterPlaylist += relativeLine + "\n"
            }
            if (line.startsWith('#EXT-X-DISCONTINUITY')) {
              masterPlaylist += line + "\n"
            }
          })
          masterPlaylist += "#EXT-X-DISCONTINUITY\n"
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

    console.log(`Checking file streams for ${slug}...`)

    // Probe file
    let audioStreams: any[] = []
    try {
      const ffprobe = promisify(ffmpeg.ffprobe)
      const metadata = await ffprobe(inputPath) as any
      audioStreams = metadata.streams.filter((s: any) => s.codec_type === 'audio')
      console.log(`Found ${audioStreams.length} audio streams for ${slug}`)
    } catch (e) {
      console.error('Probe failed:', e)
      // Fallback to basic assumption
    }

    const runConversion = (mode: 'turbo' | 'semi-turbo' | 'safe') => {
      console.log(`Attempting conversion in ${mode} mode for ${slug}`)

      if (mode !== 'turbo') {
        runChunkedConversion(mode)
        return
      }

      // Turbo Logic - Simple stream copy with audio re-encoding for HLS compatibility
      const outputOptions = [
        '-map 0:v:0',      // Map first video stream
        '-map 0:a',        // Map ALL audio streams
        '-c:v copy',       // Copy video
        '-c:a aac',        // AAC Audio
        '-hls_time 6',
        '-hls_playlist_type vod',
        '-hls_list_size 0',
      ]

      // Dynamic Stream Mapping for Multi-Audio
      if (audioStreams.length > 0) {
        // Build var_stream_map
        // Format: "v:0,agroup:audio a:0,agroup:audio,language:eng ... "

        // Video maps to first video stream and uses audio group 'audio-group'
        let streamMap = "v:0,agroup:audio-group"
        let hasLang = false

        audioStreams.forEach((stream, index) => {
          // Determine language
          const lang = stream.tags?.language || stream.tags?.TIT2 || `unk${index}`
          // const name = stream.tags?.title || stream.tags?.handler_name || `Audio ${index + 1}`

          // Add to map
          streamMap += ` a:${index},agroup:audio-group`

          if (stream.tags?.language) {
            streamMap += `,language:${stream.tags.language}`
            hasLang = true
          } else {
            // Try to guess or just leave optional
            streamMap += `,language:${index}` // default unique
          }
        })

        outputOptions.push(`-var_stream_map`, streamMap)

        // Critical: When using var_stream_map, HLS master playlist generation behavior changes.
        // We need to specify master playlist name if likely not automatic, but here the output IS the master.
        // But we need to define segment filename patterns that account for variants.
        outputOptions.push(`-master_pl_name`, `movie.m3u8`) // actually we might need to output to valid variants

        // When using var_stream_map, the direct output argument should be a pattern for the variant playlists
        // e.g. "path/to/stream_%v.m3u8"
        // And master_pl_name creates the master.
      } else {
        outputOptions.push('-hls_segment_filename', path.join(uploadDir, 'segment_%03d.ts'))
      }

      console.log("Derived Options:", outputOptions)

      const command = ffmpeg(inputPath)
        .outputOptions(outputOptions)

      if (audioStreams.length > 0) {
        // For var_stream_map, output is the pattern for Media Playlists
        command.output(path.join(uploadDir, 'stream_%v.m3u8'))
        // The master playlist is generated due to -master_pl_name

        // WE ALSO Need unique segment names for each stream
        command.outputOption('-hls_segment_filename', path.join(uploadDir, 'segment_%v_%03d.ts'))
      } else {
        // Fallback single file
        command.output(hlsPath) // movie.m3u8
      }

      command
        .on('start', (cmd) => {
          console.log(`FFmpeg command: ${cmd}`)
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            const percent = Math.round(progress.percent)
            writeFile(statusPath, JSON.stringify({ status: 'processing', progress: percent, mode })).catch(() => { })
          }
        })
        .on('end', async () => {
          console.log(`FFmpeg HLS finished for ${slug} in ${mode} mode`)

          // Sanitize Playlists (Remove Absolute Paths)
          try {
            const processPlaylist = async (filePath: string) => {
              try {
                let content = await readFile(filePath, 'utf-8')

                // Debug: Log first few lines before fix
                console.log(`[FixPaths] Processing ${path.basename(filePath)}. Preview before:`, content.split('\n').slice(0, 5))

                // Robust Replace: Create regex to match uploadDir with either slash
                // uploadDir is absolute path. We want to remove it + optional trailing slash
                // Escape special regex chars in uploadDir
                const escapedDir = uploadDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                const regex = new RegExp(escapedDir + '[\\\\/]*', 'g')

                content = content.replace(regex, '')

                // Also ensure no double slashes at start of lines (if any remain)
                // content = content.replace(/^[\/\\]+/gm, '') 

                await writeFile(filePath, content)
                console.log(`[FixPaths] Fixed ${path.basename(filePath)}.`)
              } catch (e) {
                console.warn(`[FixPaths] Could not read/write ${filePath}`, e)
              }
            }

            // Clean master playlist
            await processPlaylist(hlsPath)

            // Clean variant playlists if they exist
            // For var_stream_map, we expect stream_0.m3u8, stream_1.m3u8 etc.
            // We can just list dir and find .m3u8 files
            try {
              const files = await readdir(uploadDir)
              const m3u8Files = files.filter(f => f.endsWith('.m3u8') && f !== 'movie.m3u8')
              console.log(`[FixPaths] Found variants: ${m3u8Files.join(', ')}`)

              for (const f of m3u8Files) {
                await processPlaylist(path.join(uploadDir, f))
              }
            } catch (err) {
              console.error("[FixPaths] Error finding variants:", err)
            }

            console.log(`Playlists sanitized for ${slug}`)
          } catch (e) {
            console.error('Error sanitizing playlists:', e)
          }

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
