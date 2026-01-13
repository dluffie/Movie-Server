import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createMovieFolder, saveMetadata, slugify } from '@/lib/utils';

const execAsync = promisify(exec);

export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string || '';
    const duration = formData.get('duration') as string || '';

    if (!file || !title) {
      return NextResponse.json(
        { error: 'File and title are required' },
        { status: 400 }
      );
    }

    const slug = slugify(title);
    const movieFolder = createMovieFolder(slug);
    
    // Save uploaded file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const inputPath = path.join(movieFolder, 'original' + path.extname(file.name));
    await writeFile(inputPath, buffer);

    // Save metadata
    saveMetadata(slug, { title, slug, description, duration });

    // Convert to HLS using FFmpeg
    const outputPath = path.join(movieFolder, 'movie.m3u8');
    const ffmpegCommand = `ffmpeg -i "${inputPath}" -codec:v h264 -codec:a aac -hls_time 6 -hls_playlist_type vod -hls_segment_filename "${path.join(movieFolder, 'segment_%03d.ts')}" "${outputPath}"`;

    try {
      await execAsync(ffmpegCommand);
    } catch (ffmpegError) {
      console.error('FFmpeg error:', ffmpegError);
      return NextResponse.json(
        { error: 'Video conversion failed. Make sure FFmpeg is installed.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Movie uploaded successfully',
      slug,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}