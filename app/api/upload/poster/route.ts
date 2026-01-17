import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const slug = url.searchParams.get('slug');

        if (!slug) {
            return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
        }

        const uploadDir = path.resolve('./movies', slug);

        // Ensure directory exists (it should, but just in case)
        await mkdir(uploadDir, { recursive: true });

        // Read the image data from the body
        // We expect the body to be the raw image file, similar to the video upload
        const buffer = await req.arrayBuffer();

        if (!buffer || buffer.byteLength === 0) {
            return NextResponse.json({ error: 'Empty file body' }, { status: 400 });
        }

        const posterPath = path.join(uploadDir, 'poster.jpg');
        await writeFile(posterPath, Buffer.from(buffer));

        console.log(`Custom poster saved for ${slug}`);

        return NextResponse.json({ success: true, message: 'Poster uploaded successfully' });

    } catch (error) {
        console.error('Poster upload error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
