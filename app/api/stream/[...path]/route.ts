import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

// MIME types
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

        // Ensure resolved path stays within movies/
        const moviesDir = path.resolve('./movies')
        if (!filePath.startsWith(moviesDir)) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        // Check file exists & get size
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

        // Read the entire file into memory
        // This is fine: .ts segments are ~4MB, m3u8/posters are tiny
        // Much more reliable than Node stream -> Web stream conversion
        const fileBuffer = await readFile(filePath)

        // Common headers
        const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Cache-Control': ext === '.m3u8' ? 'no-cache, no-store' : 'public, max-age=31536000',
        }

        // Handle Range requests (needed for seeking)
        const rangeHeader = req.headers.get('range')

        if (rangeHeader) {
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

                const clampedEnd = Math.min(end, fileSize - 1)
                const chunk = fileBuffer.subarray(start, clampedEnd + 1)

                return new NextResponse(chunk, {
                    status: 206,
                    headers: {
                        ...headers,
                        'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
                        'Content-Length': chunk.length.toString(),
                    }
                })
            }
        }

        // Full file response
        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                ...headers,
                'Content-Length': fileSize.toString(),
            }
        })

    } catch (error) {
        console.error('Stream error:', error)
        return new NextResponse('Internal Server Error', { status: 500 })
    }
}

// CORS preflight
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
