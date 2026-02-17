import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile, stat, unlink, readdir, readFile } from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { promisify } from 'util'

export const dynamic = 'force-dynamic'

// Limit body parser — we handle streaming ourselves
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const lockFile = path.resolve('./processing.lock')

  try {
    // 0. Check Processing Lock
    try {
      const lockStats = await stat(lockFile)
      const lockAgeMs = Date.now() - lockStats.mtimeMs
      const isStale = lockAgeMs > 5 * 60 * 1000
      const forceUpload = req.headers.get('X-Force-Upload') === 'true'

      if (isStale || forceUpload) {
        console.warn(`Removing ${isStale ? 'stale' : 'forced'} lock file`)
        await unlink(lockFile).catch(() => { })
      } else {
        return NextResponse.json(
          { error: 'Server is busy processing another video. Please wait.' },
          { status: 429 }
        )
      }
    } catch {
      // Lock doesn't exist — free to proceed
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

    // 4. Stream File to Disk (Low RAM)
    const inputPath = path.join(uploadDir, 'input.mp4')
    const writer = createWriteStream(inputPath)

    // @ts-ignore
    const nodeStream = Readable.fromWeb(req.body)

    try {
      await pipeline(nodeStream, writer)
    } catch (writeErr) {
      await unlink(lockFile).catch(() => { })
      throw writeErr
    }

    // 5. Save Metadata
    const metadata = { title, slug, description, duration: 'Unknown' }
    await writeFile(path.join(uploadDir, 'metadata.json'), JSON.stringify(metadata, null, 2))

    // 6. Generate Thumbnail
    const skipPoster = req.headers.get('X-Skip-Poster-Gen') === 'true'

    if (!skipPoster) {
      try {
        await new Promise((resolve) => {
          ffmpeg(inputPath)
            .on('end', () => { console.log(`Poster generated for ${slug}`); resolve(true) })
            .on('error', (err) => { console.error(`Poster error:`, err.message); resolve(false) })
            .screenshots({
              count: 1,
              folder: uploadDir,
              filename: 'poster.jpg',
              timestamps: ['10%'],
              size: '320x?'
            })
        })
      } catch (e) {
        console.error("Poster generation error (non-fatal):", e)
      }
    }

    // 7. Start HLS Conversion (Background)
    const hlsPath = path.join(uploadDir, 'movie.m3u8')
    const statusPath = path.join(uploadDir, 'status.json')

    await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode: 'turbo' }))

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    // ====== SIMPLIFIED CONVERSION ======
    // Strategy: Always create a SINGLE m3u8 with all audio tracks embedded.
    // hls.js can switch audio tracks within a single variant — no var_stream_map needed.

    const runTurboConversion = async (): Promise<boolean> => {
      console.log(`[TURBO] Starting for ${slug}`)
      return new Promise((resolve) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-map 0:v:0',              // First video stream
            '-map 0:a?',               // All audio streams (? = don't fail if none)
            '-c:v copy',               // Copy video (fast)
            '-c:a aac',                // Re-encode audio to AAC for HLS compat
            '-ac 2',                   // Stereo (saves memory on decode)
            '-hls_time 10',            // 10s segments (fewer files, less overhead)
            '-hls_playlist_type vod',
            '-hls_list_size 0',
            '-hls_segment_filename', path.join(uploadDir, 'seg_%03d.ts'),
          ])
          .output(hlsPath)
          .on('start', (cmd) => console.log(`[TURBO] CMD: ${cmd}`))
          .on('progress', (p) => {
            if (p.percent) {
              writeFile(statusPath, JSON.stringify({
                status: 'processing', progress: Math.round(p.percent), mode: 'turbo'
              })).catch(() => { })
            }
          })
          .on('end', async () => {
            console.log(`[TURBO] Complete for ${slug}`)
            // Sanitize absolute paths from playlist
            await sanitizePlaylist(hlsPath, uploadDir)
            // Verify segments
            await verifySegments(uploadDir, hlsPath, statusPath)
            resolve(true)
          })
          .on('error', (err) => {
            console.error(`[TURBO] Failed:`, err.message)
            resolve(false)
          })
          .run()
      })
    }

    const runSafeConversion = async (): Promise<boolean> => {
      console.log(`[SAFE] Starting chunked conversion for ${slug}`)

      try {
        await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode: 'safe' }))

        // Split into 5-min chunks
        const segmentPattern = path.join(uploadDir, 'chunk_%03d.mp4')
        await new Promise<void>((resolve, reject) => {
          ffmpeg(inputPath)
            .outputOptions([
              '-map 0:v:0',
              '-map 0:a?',
              '-c copy',
              '-segment_time 300',
              '-f segment',
              '-reset_timestamps 1'
            ])
            .output(segmentPattern)
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .run()
        })

        // Find chunks
        const chunks = (await readdir(uploadDir))
          .filter(f => f.startsWith('chunk_') && f.endsWith('.mp4'))
          .sort()

        const totalChunks = chunks.length
        console.log(`[SAFE] Split into ${totalChunks} chunks`)

        // Process each chunk
        for (let i = 0; i < totalChunks; i++) {
          const chunkInput = path.join(uploadDir, chunks[i])
          const chunkHls = path.join(uploadDir, `out_${i}.m3u8`)

          const progress = Math.round((i / totalChunks) * 100)
          await writeFile(statusPath, JSON.stringify({
            status: 'processing', progress, mode: `safe (chunk ${i + 1}/${totalChunks})`
          }))

          // Cool down between chunks to prevent OOM
          await sleep(2000)

          await new Promise<void>((resolve, reject) => {
            ffmpeg(chunkInput)
              .outputOptions([
                '-map 0:v:0',
                '-map 0:a?',
                '-threads 1',
                '-preset ultrafast',
                '-c:v libx264',
                '-c:a aac',
                '-ac 2',
                '-hls_time 10',
                '-hls_playlist_type vod',
                '-hls_segment_filename', path.join(uploadDir, `seg_${i}_%03d.ts`)
              ])
              .output(chunkHls)
              .on('start', (cmd) => console.log(`[SAFE] Chunk ${i}: ${cmd}`))
              .on('end', () => resolve())
              .on('error', (err) => reject(err))
              .run()
          })

          // Delete intermediate chunk
          await unlink(chunkInput).catch(() => { })
        }

        // Merge playlists properly
        await mergeChunkPlaylists(uploadDir, hlsPath, totalChunks)

        // Verify
        await verifySegments(uploadDir, hlsPath, statusPath)
        return true

      } catch (e) {
        console.error(`[SAFE] Failed:`, e)
        await writeFile(statusPath, JSON.stringify({ status: 'error', error: 'Conversion failed' })).catch(() => { })
        await unlink(lockFile).catch(() => { })
        return false
      }
    }

    // Schedule conversion with delay (let Next.js finish compiling first)
    console.log(`Scheduling conversion for ${slug} in 8 seconds...`)
    setTimeout(async () => {
      try {
        const turboOk = await runTurboConversion()
        if (!turboOk) {
          console.log(`Turbo failed, falling back to safe mode...`)
          await writeFile(statusPath, JSON.stringify({
            status: 'processing', progress: 0, mode: 'safe (fallback)'
          })).catch(() => { })
          await runSafeConversion()
        }
      } catch (e) {
        console.error('Conversion error:', e)
        await writeFile(statusPath, JSON.stringify({ status: 'error', error: 'Conversion crashed' })).catch(() => { })
      } finally {
        await unlink(lockFile).catch(() => { })
      }
    }, 8000)

    return NextResponse.json({ success: true, slug, message: 'Upload received. Conversion scheduled.' })

  } catch (error) {
    console.error('Upload error:', error)
    await unlink(lockFile).catch(() => { })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// ====== HELPER FUNCTIONS ======

async function sanitizePlaylist(m3u8Path: string, uploadDir: string) {
  try {
    let content = await readFile(m3u8Path, 'utf-8')
    // Remove any absolute path prefixes from segment filenames
    const escapedDir = uploadDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedDir + '[\\\\/]*', 'g')
    content = content.replace(regex, '')
    await writeFile(m3u8Path, content)
    console.log(`[SANITIZE] Cleaned ${path.basename(m3u8Path)}`)
  } catch (e) {
    console.error('[SANITIZE] Error:', e)
  }
}

async function mergeChunkPlaylists(uploadDir: string, outputPath: string, totalChunks: number) {
  // Parse each chunk playlist and build a proper combined one
  let maxDuration = 0
  const segmentEntries: string[] = []

  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(uploadDir, `out_${i}.m3u8`)
    try {
      const content = await readFile(chunkPath, 'utf-8')
      const lines = content.split('\n')

      // Extract target duration from chunk
      for (const line of lines) {
        const tdMatch = line.match(/#EXT-X-TARGETDURATION:(\d+)/)
        if (tdMatch) {
          maxDuration = Math.max(maxDuration, parseInt(tdMatch[1]))
        }
      }

      // Collect segment entries
      for (let j = 0; j < lines.length; j++) {
        const line = lines[j].trim()
        if (line.startsWith('#EXTINF')) {
          const nextLine = (lines[j + 1] || '').trim()
          if (nextLine && !nextLine.startsWith('#')) {
            // Remove absolute path if present
            const relativeName = nextLine
              .replace(uploadDir + path.sep, '')
              .replace(uploadDir + '/', '')
            segmentEntries.push(line)
            segmentEntries.push(relativeName)
          }
        }
      }

      // Add discontinuity marker between chunks (not after last)
      if (i < totalChunks - 1) {
        segmentEntries.push('#EXT-X-DISCONTINUITY')
      }

      // Clean up chunk playlist
      await unlink(chunkPath).catch(() => { })
    } catch (e) {
      console.error(`[MERGE] Error reading chunk ${i}:`, e)
    }
  }

  if (maxDuration === 0) maxDuration = 11 // fallback

  // Build final playlist
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${maxDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    ...segmentEntries,
    '#EXT-X-ENDLIST'
  ].join('\n')

  await writeFile(outputPath, playlist)
  console.log(`[MERGE] Created merged playlist with ${segmentEntries.filter(e => e.endsWith('.ts')).length} segments`)
}

async function verifySegments(uploadDir: string, m3u8Path: string, statusPath: string) {
  try {
    const content = await readFile(m3u8Path, 'utf-8')
    const lines = content.split('\n')
    let valid = 0
    let invalid = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.endsWith('.ts') && !trimmed.startsWith('#')) {
        const segPath = path.join(uploadDir, trimmed)
        try {
          const s = await stat(segPath)
          if (s.size > 0) valid++
          else invalid++
        } catch {
          invalid++
        }
      }
    }

    console.log(`[VERIFY] ${valid} valid segments, ${invalid} invalid`)

    if (invalid > 0) {
      await writeFile(statusPath, JSON.stringify({
        status: 'error',
        error: `${invalid} segments are missing or empty`,
        validSegments: valid,
        invalidSegments: invalid
      }))
    } else {
      await writeFile(statusPath, JSON.stringify({
        status: 'ready',
        progress: 100,
        segments: valid,
        verified: true
      }))
    }
  } catch (e) {
    console.error('[VERIFY] Error:', e)
    await writeFile(statusPath, JSON.stringify({ status: 'ready', progress: 100 }))
  }
}
