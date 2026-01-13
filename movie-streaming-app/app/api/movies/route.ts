import { NextResponse } from 'next/server';
import { getAllMovies } from '@/lib/utils';

export async function GET() {
  try {
    const movies = getAllMovies();
    return NextResponse.json({ movies });
  } catch (error) {
    console.error('Error fetching movies:', error);
    return NextResponse.json(
      { error: 'Failed to fetch movies' },
      { status: 500 }
    );
  }
}