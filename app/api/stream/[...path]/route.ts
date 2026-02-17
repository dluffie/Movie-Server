import { NextRequest, NextResponse } from 'next/server'
import { stat, open } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'

export const dynamic = 'force-dynamic'

// MIME types for streaming
const MIME_MAP: Record<string, string> = {
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
    '.mp4': 'video/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.vtt': 'text/vtt',
    '.srt': 'text/plain',
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path: segments } = await params

        // Security: block directory traversal
        const joined = segments.join('/')
        if (joined.includes('..') || joined.includes('~')) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        const filePath = path.resolve('./movies', ...segments)

        // Ensure the resolved path is still within movies/
        const moviesDir = path.resolve('./movies')
        if (!filePath.startsWith(moviesDir)) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        // Check file exists
        let fileStat
        try {
            fileStat = await stat(filePath)
        } catch {
            return new NextResponse('Not Found', { status: 404 })
        }

        if (!fileStat.isFile()) {
            return new NextResponse('Not Found', { status: 404 })
        }

        const ext = path.extname(filePath).toLowerCase()
        const contentType = MIME_MAP[ext] || 'application/octet-stream'
        const fileSize = fileStat.size

        // Common headers
        const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Cache-Control': ext === '.m3u8' ? 'no-cache' : 'public, max-age=31536000',
        }

        // Handle Range requests (critical for video seeking)
        const rangeHeader = req.headers.get('range')

        if (rangeHeader && (ext === '.ts' || ext === '.mp4')) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
            if (match) {
                const start = parseInt(match[1], 10)
                const end = match[2] ? parseInt(match[2], 10) : fileSize - 1

                if (start >= fileSize) {
                    return new NextResponse('Range Not Satisfiable', {
                        status: 416,
                        headers: { 'Content-Range': `bytes */${fileSize}` }
                    })
                }

                const chunkSize = end - start + 1

                // Stream the range using file handle
                const fileHandle = await open(filePath, 'r')
                const stream = fileHandle.createReadStream({ start, end })

                // Convert Node readable to Web ReadableStream
                const webStream = Readable.toWeb(stream) as ReadableStream

                return new NextResponse(webStream, {
                    status: 206,
                    headers: {
                        ...headers,
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Content-Length': chunkSize.toString(),
                        'Accept-Ranges': 'bytes',
                    }
                })
            }
        }

        // For small files (playlists, posters) — read fully
        // For .ts segments — stream to keep RAM low
        if (fileSize < 1024 * 512) {
            // < 512KB: read fully (playlists, posters, subtitles)
            const fileHandle = await open(filePath, 'r')
            const buffer = Buffer.alloc(fileSize)
            await fileHandle.read(buffer, 0, fileSize, 0)
            await fileHandle.close()

            return new NextResponse(buffer, {
                status: 200,
                headers: {
                    ...headers,
                    'Content-Length': fileSize.toString(),
                    'Accept-Ranges': 'bytes',
                }
            })
        }

        // Large files: stream
        const fileHandle = await open(filePath, 'r')
        const stream = fileHandle.createReadStream()
        const webStream = Readable.toWeb(stream) as ReadableStream

        return new NextResponse(webStream, {
            status: 200,
            headers: {
                ...headers,
                'Content-Length': fileSize.toString(),
                'Accept-Ranges': 'bytes',
            }
        })

    } catch (error) {
        console.error('Stream error:', error)
        return new NextResponse('Internal Server Error', { status: 500 })
    }
}

// Handle CORS preflight
export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
        }
    })
}
