import { NextResponse } from 'next/server'
import { readdir, readFile } from 'fs/promises'
import path from 'path'

export async function GET() {
    const moviesDir = path.resolve('./movies')

    try {
        const entries = await readdir(moviesDir, { withFileTypes: true })
        const directories = entries.filter(e => e.isDirectory())

        const movies = await Promise.all(directories.map(async (dir) => {
            const slug = dir.name
            const metadataPath = path.join(moviesDir, slug, 'metadata.json')

            try {
                const content = await readFile(metadataPath, 'utf-8')
                const meta = JSON.parse(content)
                return {
                    ...meta,
                    poster: encodeURI(`/api/poster/${slug}`) // We need a way to serve the poster locally since Nginx serves /hls/. 
                    // Or we can serve poster via Nginx too?
                    // Spec says "No database (filesystem = source of truth)".
                    // Nginx serves /hls/... content. If poster is in the same folder, Nginx can serve it.
                    // URL: http://localhost:8080/hls/<slug>/poster.jpg
                    // But frontend needs to know this URL.
                    // Let's return the relative Nginx path or absolute URL?
                    // If we use separate ports, we need absolute URL.
                    // But we don't know the IP. 
                    // The frontend can construct the URL using window.location.hostname.
                    // So we just return the "path" relative to HLS root.
                }
            } catch (e) {
                return null // Skip invalid folders
            }
        }))

        return NextResponse.json({ movies: movies.filter(Boolean) })
    } catch (error) {
        // If movies dir doesn't exist yet
        return NextResponse.json({ movies: [] })
    }
}
