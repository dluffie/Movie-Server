'use client';

import { useEffect, useState } from 'react';
import { Movie } from '@/lib/types';

export default function HomePage() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMovies();
  }, []);

  async function fetchMovies() {
    try {
      const response = await fetch('/api/movies');
      const data = await response.json();
      setMovies(data.movies || []);
    } catch (error) {
      console.error('Error fetching movies:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredMovies = movies.filter(movie =>
    movie.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p className="text-gray-400">Loading movies...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <input
          type="text"
          placeholder="Search movies..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-bar"
        />
      </div>

      {filteredMovies.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          <p className="text-xl mb-4">
            {searchQuery ? 'No movies found' : 'No movies available'}
          </p>
          <a
            href="/upload"
            className="text-blue-500 hover:text-blue-400 underline"
          >
            Upload your first movie
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {filteredMovies.map((movie) => (
            <a
              key={movie.slug}
              href={`/movie/${movie.slug}`}
              className="movie-card"
            >
              {movie.posterUrl ? (
                <img
                  src={movie.posterUrl}
                  alt={movie.title}
                  className="movie-poster"
                />
              ) : (
                <div className="movie-poster flex items-center justify-center">
                  <span className="text-4xl">🎬</span>
                </div>
              )}
              <div className="p-4">
                <h3 className="font-semibold text-lg mb-1 truncate">
                  {movie.title}
                </h3>
                <p className="text-sm text-gray-400">{movie.duration}</p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}