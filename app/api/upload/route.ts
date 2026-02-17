import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile, stat, unlink, readdir, readFile } from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { promisify } from 'util'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ffprobe = promisify(ffmpeg.ffprobe)

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

    if (!req.body) {
      return NextResponse.json({ error: 'Missing file body' }, { status: 400 })
    }

    // CREATE LOCK
    await writeFile(lockFile, JSON.stringify({ title, startTime: Date.now() }))

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const uploadDir = path.resolve('./movies', slug)
    await mkdir(uploadDir, { recursive: true })

    // Stream File to Disk
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

    // Save Metadata
    await writeFile(
      path.join(uploadDir, 'metadata.json'),
      JSON.stringify({ title, slug, description, duration: 'Unknown' }, null, 2)
    )

    // Generate Thumbnail
    const skipPoster = req.headers.get('X-Skip-Poster-Gen') === 'true'
    if (!skipPoster) {
      try {
        await new Promise((resolve) => {
          ffmpeg(inputPath)
            .on('end', () => { console.log(`Poster generated for ${slug}`); resolve(true) })
            .on('error', (err) => { console.error(`Poster error:`, err.message); resolve(false) })
            .screenshots({
              count: 1, folder: uploadDir, filename: 'poster.jpg',
              timestamps: ['10%'], size: '320x?'
            })
        })
      } catch (e) {
        console.error("Poster error (non-fatal):", e)
      }
    }

    // ====== PROBE INPUT FILE ======
    const statusPath = path.join(uploadDir, 'status.json')
    await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode: 'probing' }))

    let videoCodecName = 'unknown'
    let audioStreams: any[] = []

    try {
      const probeData = await ffprobe(inputPath) as any
      const videoStream = probeData.streams.find((s: any) => s.codec_type === 'video')
      audioStreams = probeData.streams.filter((s: any) => s.codec_type === 'audio')

      if (videoStream) {
        videoCodecName = videoStream.codec_name || 'unknown'
      }

      console.log(`[PROBE] Video codec: ${videoCodecName}, Audio tracks: ${audioStreams.length}`)
      audioStreams.forEach((s: any, i: number) => {
        console.log(`  Audio ${i}: codec=${s.codec_name}, lang=${s.tags?.language || 'unknown'}`)
      })
    } catch (e) {
      console.error('[PROBE] Failed:', e)
      // Fallback: assume needs re-encode, single audio
    }

    // Decide video encoding strategy
    // H.264 = can copy, anything else (H.265/HEVC/VP9/AV1) = must re-encode for browsers
    const canCopyVideo = ['h264', 'avc', 'avc1'].includes(videoCodecName.toLowerCase())

    console.log(`[STRATEGY] Video: ${canCopyVideo ? 'COPY (H.264)' : `RE-ENCODE (${videoCodecName} → H.264)`}`)
    console.log(`[STRATEGY] Audio tracks: ${audioStreams.length}`)

    // ====== CONVERSION ======
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    const hlsPath = path.join(uploadDir, 'movie.m3u8')
    const hasMultiAudio = audioStreams.length > 1

    const runConversion = async (): Promise<boolean> => {
      const mode = canCopyVideo ? 'turbo' : 'safe'
      console.log(`[${mode.toUpperCase()}] Starting for ${slug}`)
      await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode }))

      return new Promise((resolve) => {
        // Build FFmpeg options
        const outputOptions: string[] = []

        // Video codec
        if (canCopyVideo) {
          outputOptions.push('-c:v', 'copy')
        } else {
          outputOptions.push(
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-profile:v', 'main',
            '-level', '4.0',
            '-threads', '2',
          )
        }

        // Audio codec (always AAC for HLS compatibility)
        outputOptions.push('-c:a', 'aac', '-ac', '2')

        // HLS options
        outputOptions.push(
          '-hls_time', '10',
          '-hls_playlist_type', 'vod',
          '-hls_list_size', '0',
        )

        if (hasMultiAudio) {
          // ====== MULTI-AUDIO with var_stream_map ======
          // Map video + all audio streams
          outputOptions.push('-map', '0:v:0')
          audioStreams.forEach((_: any, i: number) => {
            outputOptions.push('-map', `0:a:${i}`)
          })

          // Build var_stream_map string
          let varMap = 'v:0,agroup:audio'
          audioStreams.forEach((stream: any, i: number) => {
            const lang = stream.tags?.language || `audio_${i}`
            const name = stream.tags?.title || stream.tags?.handler_name || lang
            // Clean name (remove spaces/special chars for HLS compatibility)
            const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
            varMap += ` a:${i},agroup:audio,language:${lang},name:${cleanName}`

            // Set default: first track is default
            if (i === 0) {
              varMap = varMap.replace(
                `a:${i},agroup:audio`,
                `a:${i},agroup:audio,default:yes`
              )
            }
          })

          outputOptions.push('-var_stream_map', varMap)
          outputOptions.push('-master_pl_name', 'movie.m3u8')
          outputOptions.push(
            '-hls_segment_filename',
            path.join(uploadDir, 'seg_%v_%03d.ts')
          )

          console.log(`[MULTI-AUDIO] var_stream_map: ${varMap}`)

          // With var_stream_map, output is the PATTERN for variant playlists
          const cmd = ffmpeg(inputPath)
            .outputOptions(outputOptions)
            .output(path.join(uploadDir, 'stream_%v.m3u8'))
            .on('start', (cmdStr) => console.log(`[FFMPEG] ${cmdStr}`))
            .on('progress', (p) => {
              if (p.percent) {
                writeFile(statusPath, JSON.stringify({
                  status: 'processing', progress: Math.round(p.percent), mode
                })).catch(() => { })
              }
            })
            .on('end', async () => {
              console.log(`[${mode.toUpperCase()}] Conversion complete for ${slug}`)
              // Sanitize ALL playlists
              await sanitizeAllPlaylists(uploadDir)
              await verifySegments(uploadDir, hlsPath, statusPath)
              resolve(true)
            })
            .on('error', (err) => {
              console.error(`[${mode.toUpperCase()}] Failed:`, err.message)
              resolve(false)
            })

          cmd.run()

        } else {
          // ====== SINGLE AUDIO (simple) ======
          outputOptions.push('-map', '0:v:0', '-map', '0:a:0?')
          outputOptions.push(
            '-hls_segment_filename',
            path.join(uploadDir, 'seg_%03d.ts')
          )

          const cmd = ffmpeg(inputPath)
            .outputOptions(outputOptions)
            .output(hlsPath)
            .on('start', (cmdStr) => console.log(`[FFMPEG] ${cmdStr}`))
            .on('progress', (p) => {
              if (p.percent) {
                writeFile(statusPath, JSON.stringify({
                  status: 'processing', progress: Math.round(p.percent), mode
                })).catch(() => { })
              }
            })
            .on('end', async () => {
              console.log(`[${mode.toUpperCase()}] Conversion complete for ${slug}`)
              await sanitizePlaylist(hlsPath, uploadDir)
              await verifySegments(uploadDir, hlsPath, statusPath)
              resolve(true)
            })
            .on('error', (err) => {
              console.error(`[${mode.toUpperCase()}] Failed:`, err.message)
              resolve(false)
            })

          cmd.run()
        }
      })
    }

    // Fallback: re-encode everything if turbo copy fails
    const runFallbackConversion = async (): Promise<boolean> => {
      console.log(`[FALLBACK] Re-encoding everything for ${slug}`)
      await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode: 'fallback' }))

      // Clean up any previous attempt files
      try {
        const files = await readdir(uploadDir)
        for (const f of files) {
          if (f.endsWith('.ts') || (f.endsWith('.m3u8') && f !== 'movie.m3u8')) {
            await unlink(path.join(uploadDir, f)).catch(() => { })
          }
        }
      } catch { }

      return new Promise((resolve) => {
        const outputOptions: string[] = [
          '-map', '0:v:0',
          '-map', '0:a?',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-profile:v', 'main',
          '-level', '4.0',
          '-threads', '2',
          '-c:a', 'aac',
          '-ac', '2',
          '-hls_time', '10',
          '-hls_playlist_type', 'vod',
          '-hls_list_size', '0',
          '-hls_segment_filename', path.join(uploadDir, 'seg_%03d.ts'),
        ]

        ffmpeg(inputPath)
          .outputOptions(outputOptions)
          .output(hlsPath)
          .on('start', (cmd) => console.log(`[FALLBACK] ${cmd}`))
          .on('progress', (p) => {
            if (p.percent) {
              writeFile(statusPath, JSON.stringify({
                status: 'processing', progress: Math.round(p.percent), mode: 'fallback'
              })).catch(() => { })
            }
          })
          .on('end', async () => {
            console.log(`[FALLBACK] Complete for ${slug}`)
            await sanitizePlaylist(hlsPath, uploadDir)
            await verifySegments(uploadDir, hlsPath, statusPath)
            resolve(true)
          })
          .on('error', (err) => {
            console.error(`[FALLBACK] Failed:`, err.message)
            resolve(false)
          })
          .run()
      })
    }

    // Schedule conversion
    console.log(`Scheduling conversion for ${slug} in 8 seconds...`)
    setTimeout(async () => {
      try {
        const ok = await runConversion()
        if (!ok) {
          console.log('Primary conversion failed, running fallback...')
          const fallbackOk = await runFallbackConversion()
          if (!fallbackOk) {
            await writeFile(statusPath, JSON.stringify({
              status: 'error', error: 'All conversion modes failed'
            })).catch(() => { })
          }
        }
      } catch (e) {
        console.error('Conversion crashed:', e)
        await writeFile(statusPath, JSON.stringify({
          status: 'error', error: 'Conversion crashed'
        })).catch(() => { })
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

// ====== HELPERS ======

async function sanitizePlaylist(m3u8Path: string, uploadDir: string) {
  try {
    let content = await readFile(m3u8Path, 'utf-8')
    const escapedDir = uploadDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedDir + '[\\\\/]*', 'g')
    content = content.replace(regex, '')
    await writeFile(m3u8Path, content)
    console.log(`[SANITIZE] Cleaned ${path.basename(m3u8Path)}`)
  } catch (e) {
    console.error(`[SANITIZE] Error on ${m3u8Path}:`, e)
  }
}

async function sanitizeAllPlaylists(uploadDir: string) {
  try {
    const files = await readdir(uploadDir)
    const m3u8Files = files.filter(f => f.endsWith('.m3u8'))
    console.log(`[SANITIZE] Found playlists: ${m3u8Files.join(', ')}`)
    for (const f of m3u8Files) {
      await sanitizePlaylist(path.join(uploadDir, f), uploadDir)
    }
  } catch (e) {
    console.error('[SANITIZE] Error:', e)
  }
}

async function verifySegments(uploadDir: string, m3u8Path: string, statusPath: string) {
  try {
    // Read master playlist
    const masterContent = await readFile(m3u8Path, 'utf-8')

    // Collect ALL playlists to check (master + variants)
    const allSegments: string[] = []
    const playlistsToCheck = [m3u8Path]

    // Find variant playlists referenced in master
    const lines = masterContent.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.endsWith('.m3u8') && !trimmed.startsWith('#')) {
        playlistsToCheck.push(path.join(uploadDir, trimmed))
      }
    }

    // Collect segments from all playlists
    for (const playlist of playlistsToCheck) {
      try {
        const content = await readFile(playlist, 'utf-8')
        for (const l of content.split('\n')) {
          const t = l.trim()
          if (t.endsWith('.ts') && !t.startsWith('#')) {
            allSegments.push(t)
          }
        }
      } catch { }
    }

    let valid = 0, invalid = 0
    for (const seg of allSegments) {
      try {
        const s = await stat(path.join(uploadDir, seg))
        if (s.size > 0) valid++
        else invalid++
      } catch { invalid++ }
    }

    console.log(`[VERIFY] ${valid} valid, ${invalid} invalid segments`)

    if (invalid > 0) {
      await writeFile(statusPath, JSON.stringify({
        status: 'error',
        error: `${invalid} segments missing or empty`,
        validSegments: valid, invalidSegments: invalid
      }))
    } else {
      await writeFile(statusPath, JSON.stringify({
        status: 'ready', progress: 100, segments: valid, verified: true
      }))
    }
  } catch (e) {
    console.error('[VERIFY] Error:', e)
    await writeFile(statusPath, JSON.stringify({ status: 'ready', progress: 100 }))
  }
}
