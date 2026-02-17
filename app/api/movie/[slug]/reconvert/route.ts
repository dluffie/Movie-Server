import { NextRequest, NextResponse } from 'next/server'
import { stat, readdir, unlink, writeFile, readFile } from 'fs/promises'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { promisify } from 'util'

export const dynamic = 'force-dynamic'
const ffprobe = promisify(ffmpeg.ffprobe)

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    try {
        const { slug } = await params

        if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
            return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
        }

        const movieDir = path.resolve('./movies', slug)
        const inputPath = path.join(movieDir, 'input.mp4')
        const statusPath = path.join(movieDir, 'status.json')
        const hlsPath = path.join(movieDir, 'movie.m3u8')

        // Check input exists
        try {
            await stat(inputPath)
        } catch {
            return NextResponse.json({ error: 'No input.mp4 found for this movie' }, { status: 404 })
        }

        // Clean old conversion files
        const files = await readdir(movieDir)
        for (const f of files) {
            if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
                await unlink(path.join(movieDir, f)).catch(() => { })
            }
        }

        // Probe
        await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode: 'probing' }))

        let videoCodecName = 'unknown'
        let audioStreams: any[] = []

        try {
            const probeData = await ffprobe(inputPath) as any
            const videoStream = probeData.streams.find((s: any) => s.codec_type === 'video')
            audioStreams = probeData.streams.filter((s: any) => s.codec_type === 'audio')
            if (videoStream) videoCodecName = videoStream.codec_name || 'unknown'

            console.log(`[RECONVERT] Video: ${videoCodecName}, Audio tracks: ${audioStreams.length}`)
        } catch (e) {
            console.error('[RECONVERT] Probe failed:', e)
        }

        const canCopyVideo = ['h264', 'avc', 'avc1'].includes(videoCodecName.toLowerCase())
        const hasMultiAudio = audioStreams.length > 1
        const mode = canCopyVideo ? 'turbo' : 'safe'

        console.log(`[RECONVERT] Strategy: ${mode}, multi-audio: ${hasMultiAudio}`)

        // Start conversion in background
        setTimeout(async () => {
            try {
                await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0, mode }))

                const outputOptions: string[] = []

                if (canCopyVideo) {
                    outputOptions.push('-c:v', 'copy')
                } else {
                    outputOptions.push('-c:v', 'libx264', '-preset', 'ultrafast', '-profile:v', 'main', '-level', '4.0', '-threads', '2')
                }

                outputOptions.push('-c:a', 'aac', '-ac', '2')
                outputOptions.push('-hls_time', '10', '-hls_playlist_type', 'vod', '-hls_list_size', '0')

                if (hasMultiAudio) {
                    outputOptions.push('-map', '0:v:0')
                    audioStreams.forEach((_: any, i: number) => outputOptions.push('-map', `0:a:${i}`))

                    let varMap = 'v:0,agroup:audio'
                    audioStreams.forEach((stream: any, i: number) => {
                        const lang = stream.tags?.language || `und${i}`
                        const name = `${lang}_${i}`
                        varMap += ` a:${i},agroup:audio,language:${lang},name:${name}`
                        if (i === 0) {
                            varMap = varMap.replace(`a:${i},agroup:audio`, `a:${i},agroup:audio,default:yes`)
                        }
                    })

                    outputOptions.push('-var_stream_map', varMap)
                    outputOptions.push('-master_pl_name', 'movie.m3u8')
                    outputOptions.push('-hls_segment_filename', path.join(movieDir, 'seg_%v_%03d.ts'))

                    console.log(`[RECONVERT] var_stream_map: ${varMap}`)

                    ffmpeg(inputPath)
                        .outputOptions(outputOptions)
                        .output(path.join(movieDir, 'stream_%v.m3u8'))
                        .on('start', (cmd) => console.log(`[RECONVERT] ${cmd}`))
                        .on('progress', (p) => {
                            if (p.percent) {
                                writeFile(statusPath, JSON.stringify({ status: 'processing', progress: Math.round(p.percent), mode })).catch(() => { })
                            }
                        })
                        .on('end', async () => {
                            console.log(`[RECONVERT] Complete!`)
                            await sanitizeAllPlaylists(movieDir)
                            await writeFile(statusPath, JSON.stringify({ status: 'ready', progress: 100, verified: true }))
                        })
                        .on('error', async (err) => {
                            console.error(`[RECONVERT] Failed:`, err.message)
                            await writeFile(statusPath, JSON.stringify({ status: 'error', error: err.message }))
                        })
                        .run()

                } else {
                    outputOptions.push('-map', '0:v:0', '-map', '0:a:0?')
                    outputOptions.push('-hls_segment_filename', path.join(movieDir, 'seg_%03d.ts'))

                    ffmpeg(inputPath)
                        .outputOptions(outputOptions)
                        .output(hlsPath)
                        .on('start', (cmd) => console.log(`[RECONVERT] ${cmd}`))
                        .on('progress', (p) => {
                            if (p.percent) {
                                writeFile(statusPath, JSON.stringify({ status: 'processing', progress: Math.round(p.percent), mode })).catch(() => { })
                            }
                        })
                        .on('end', async () => {
                            console.log(`[RECONVERT] Complete!`)
                            await sanitizePlaylist(hlsPath, movieDir)
                            await writeFile(statusPath, JSON.stringify({ status: 'ready', progress: 100, verified: true }))
                        })
                        .on('error', async (err) => {
                            console.error(`[RECONVERT] Failed:`, err.message)
                            await writeFile(statusPath, JSON.stringify({ status: 'error', error: err.message }))
                        })
                        .run()
                }
            } catch (e) {
                console.error('[RECONVERT] Crashed:', e)
                await writeFile(statusPath, JSON.stringify({ status: 'error', error: 'Conversion crashed' }))
            }
        }, 2000)

        return NextResponse.json({ success: true, slug, mode, multiAudio: hasMultiAudio, message: 'Re-conversion started' })

    } catch (error) {
        console.error('Reconvert error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}

// Helpers
async function sanitizePlaylist(m3u8Path: string, dir: string) {
    try {
        let content = await readFile(m3u8Path, 'utf-8')
        const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        content = content.replace(new RegExp(escaped + '[\\\\/]*', 'g'), '')
        await writeFile(m3u8Path, content)
        console.log(`[SANITIZE] Cleaned ${path.basename(m3u8Path)}`)
    } catch (e) { console.error(`[SANITIZE] Error:`, e) }
}

async function sanitizeAllPlaylists(dir: string) {
    const files = await readdir(dir)
    for (const f of files.filter(f => f.endsWith('.m3u8'))) {
        await sanitizePlaylist(path.join(dir, f), dir)
    }
}
