import fs from 'fs';
import path from 'path';
import { MovieMetadata, Movie } from './types';

const MOVIES_DIR = path.join(process.cwd(), 'movies');

export function getMoviesDirectory(): string {
  if (!fs.existsSync(MOVIES_DIR)) {
    fs.mkdirSync(MOVIES_DIR, { recursive: true });
  }
  return MOVIES_DIR;
}

export function getAllMovies(): Movie[] {
  const moviesDir = getMoviesDirectory();
  const folders = fs.readdirSync(moviesDir);
  
  const movies: Movie[] = [];
  
  for (const folder of folders) {
    const folderPath = path.join(moviesDir, folder);
    const metadataPath = path.join(folderPath, 'metadata.json');
    
    if (fs.statSync(folderPath).isDirectory() && fs.existsSync(metadataPath)) {
      try {
        const metadata: MovieMetadata = JSON.parse(
          fs.readFileSync(metadataPath, 'utf-8')
        );
        
        movies.push({
          ...metadata,
          streamUrl: `/hls/${metadata.slug}/movie.m3u8`,
          folderPath: folderPath,
        });
      } catch (error) {
        console.error(`Error reading metadata for ${folder}:`, error);
      }
    }
  }
  
  return movies;
}

export function getMovieBySlug(slug: string): Movie | null {
  const movies = getAllMovies();
  return movies.find(m => m.slug === slug) || null;
}

export function createMovieFolder(slug: string): string {
  const moviesDir = getMoviesDirectory();
  const moviePath = path.join(moviesDir, slug);
  
  if (!fs.existsSync(moviePath)) {
    fs.mkdirSync(moviePath, { recursive: true });
  }
  
  return moviePath;
}

export function saveMetadata(slug: string, metadata: MovieMetadata): void {
  const moviePath = createMovieFolder(slug);
  const metadataPath = path.join(moviePath, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}