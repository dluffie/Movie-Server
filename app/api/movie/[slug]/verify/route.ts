import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    try {
        const { slug } = await params

        // Security check
        if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
            return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
        }

        const movieDir = path.resolve('./movies', slug)
        const m3u8Path = path.join(movieDir, 'movie.m3u8')

        // 1. Check if master playlist exists
        let playlistContent: string
        try {
            playlistContent = await readFile(m3u8Path, 'utf-8')
        } catch {
            return NextResponse.json({
                valid: false,
                error: 'Playlist file not found',
                status: 'missing'
            })
        }

        // 2. Validate playlist syntax
        const lines = playlistContent.split('\n').map(l => l.trim()).filter(Boolean)

        if (!lines[0]?.includes('#EXTM3U')) {
            return NextResponse.json({
                valid: false,
                error: 'Invalid playlist: missing #EXTM3U header',
                status: 'corrupt'
            })
        }

        const hasEndList = lines.some(l => l.includes('#EXT-X-ENDLIST'))
        if (!hasEndList) {
            return NextResponse.json({
                valid: false,
                error: 'Playlist is incomplete (missing #EXT-X-ENDLIST). Still processing?',
                status: 'incomplete'
            })
        }

        // 3. Extract all segment references (.ts files)
        const segments: string[] = []
        for (const line of lines) {
            if (line.endsWith('.ts') && !line.startsWith('#')) {
                segments.push(line)
            }
        }

        if (segments.length === 0) {
            return NextResponse.json({
                valid: false,
                error: 'No .ts segments found in playlist',
                status: 'empty'
            })
        }

        // 4. Verify each segment exists and has data
        const results = {
            totalSegments: segments.length,
            validSegments: 0,
            invalidSegments: [] as string[],
            totalSizeBytes: 0,
            totalSizeMB: 0,
        }

        for (const seg of segments) {
            const segPath = path.join(movieDir, seg)
            try {
                const segStat = await stat(segPath)
                if (segStat.size > 0) {
                    results.validSegments++
                    results.totalSizeBytes += segStat.size
                } else {
                    results.invalidSegments.push(`${seg} (empty file)`)
                }
            } catch {
                results.invalidSegments.push(`${seg} (missing)`)
            }
        }

        results.totalSizeMB = Math.round((results.totalSizeBytes / (1024 * 1024)) * 100) / 100

        const valid = results.invalidSegments.length === 0

        return NextResponse.json({
            valid,
            status: valid ? 'verified' : 'corrupt',
            playlist: 'movie.m3u8',
            hasEndList,
            ...results,
        })

    } catch (error) {
        console.error('Verify error:', error)
        return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
    }
}
