import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir, stat } from 'fs/promises'
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

        const lines = playlistContent.split('\n').map(l => l.trim()).filter(Boolean)

        if (!lines[0]?.includes('#EXTM3U')) {
            return NextResponse.json({
                valid: false,
                error: 'Invalid playlist: missing #EXTM3U header',
                status: 'corrupt'
            })
        }

        // 2. Detect if this is a master playlist (has #EXT-X-STREAM-INF or #EXT-X-MEDIA)
        const isMasterPlaylist = lines.some(l =>
            l.includes('#EXT-X-STREAM-INF') || l.includes('#EXT-X-MEDIA')
        )

        // 3. Collect all variant playlists and segments
        const allSegments: string[] = []
        let hasEndList = false

        if (isMasterPlaylist) {
            // Master playlist: find variant playlists, check THOSE for ENDLIST
            const variantPlaylists: string[] = []
            for (const line of lines) {
                if (line.endsWith('.m3u8') && !line.startsWith('#')) {
                    variantPlaylists.push(line)
                }
            }

            for (const variant of variantPlaylists) {
                try {
                    const variantContent = await readFile(path.join(movieDir, variant), 'utf-8')
                    const variantLines = variantContent.split('\n').map(l => l.trim()).filter(Boolean)

                    if (variantLines.some(l => l.includes('#EXT-X-ENDLIST'))) {
                        hasEndList = true
                    }

                    for (const vl of variantLines) {
                        if (vl.endsWith('.ts') && !vl.startsWith('#')) {
                            allSegments.push(vl)
                        }
                    }
                } catch (e) {
                    console.error(`Verify: couldn't read variant ${variant}:`, e)
                }
            }
        } else {
            // Simple playlist: check directly
            hasEndList = lines.some(l => l.includes('#EXT-X-ENDLIST'))
            for (const line of lines) {
                if (line.endsWith('.ts') && !line.startsWith('#')) {
                    allSegments.push(line)
                }
            }
        }

        if (!hasEndList) {
            return NextResponse.json({
                valid: false,
                error: 'Playlist is incomplete (missing #EXT-X-ENDLIST). Still processing?',
                status: 'incomplete'
            })
        }

        if (allSegments.length === 0) {
            return NextResponse.json({
                valid: false,
                error: 'No .ts segments found in playlist',
                status: 'empty'
            })
        }

        // 4. Verify each segment exists and has data
        const results = {
            totalSegments: allSegments.length,
            validSegments: 0,
            invalidSegments: [] as string[],
            totalSizeBytes: 0,
            totalSizeMB: 0,
            isMasterPlaylist,
        }

        for (const seg of allSegments) {
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
