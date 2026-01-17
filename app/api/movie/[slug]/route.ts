import { NextRequest, NextResponse } from 'next/server'
import { rm } from 'fs/promises'
import path from 'path'

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ slug: string }> } // In Next.js 15, params is a Promise
) {
    try {
        const { slug } = await params

        if (!slug) {
            return NextResponse.json({ error: 'Slug is required' }, { status: 400 })
        }

        // Security check: prevent directory traversal
        if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
            return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
        }

        const movieDir = path.resolve('./movies', slug)

        // Delete recursively and force (standard "rm -rf")
        await rm(movieDir, { recursive: true, force: true })

        return NextResponse.json({ success: true, message: 'Movie deleted permanently' })
    } catch (error) {
        console.error('Delete error:', error)
        return NextResponse.json({ error: 'Failed to delete movie' }, { status: 500 })
    }
}
