import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
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

        const statusPath = path.resolve('./movies', slug, 'status.json')

        try {
            const content = await readFile(statusPath, 'utf-8')
            const status = JSON.parse(content)
            return NextResponse.json(status)
        } catch (e) {
            // If status file doesn't exist, check if movie.m3u8 exists (could be old upload)
            const hlsPath = path.resolve('./movies', slug, 'movie.m3u8')
            try {
                await readFile(hlsPath) // Check if exists
                return NextResponse.json({ status: 'ready', progress: 100 })
            } catch (err) {
                return NextResponse.json({ status: 'not-found', progress: 0 })
            }
        }
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
