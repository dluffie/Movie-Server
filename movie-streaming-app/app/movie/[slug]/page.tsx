'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Hls from 'hls.js';
import { Movie } from '@/lib/types';

export default function MoviePlayerPage() {
  const params = useParams();
  const slug = params.slug as string;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMovie();
  }, [slug]);

  useEffect(() => {
    if (movie && videoRef.current) {
      initializePlayer();
    }
  }, [movie]);

  async function fetchMovie() {
    try {
      const response = await fetch('/api/movies');
      const data = await response.json();
      const foundMovie = data.movies.find((m: Movie) => m.slug === slug);
      
      if (foundMovie) {
        setMovie(foundMovie);
      } else {
        setError('Movie not found');
      }
    } catch (err) {
      setError('Error loading movie');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function initializePlayer() {
    if (!videoRef.current || !movie) return;

    const video = videoRef.current;
    const streamUrl = `http://localhost:8080${movie.streamUrl}`;

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: false,
      });
      
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest loaded');
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          setError('Error loading video stream');
        }
      });

      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = streamUrl;
    } else {
      setError('HLS not supported in this browser');
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p className="text-gray-400">Loading movie...</p>
      </div>
    );
  }

  if (error || !movie) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p className="text-red-500 mb-4">{error || 'Movie not found'}</p>
        <a href="/" className="text-blue-500 hover:text-blue-400 underline">
          Back to home
        </a>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6">
        <a
          href="/"
          className="text-blue-500 hover:text-blue-400 inline-flex items-center mb-4"
        >
          ← Back to movies
        </a>
        <h1 className="text-3xl font-bold mb-2">{movie.title}</h1>
        <p className="text-gray-400 mb-4">{movie.duration}</p>
        {movie.description && (
          <p className="text-gray-300">{movie.description}</p>
        )}
      </div>

      <div className="bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          controls
          className="w-full aspect-video"
          autoPlay
        >
          Your browser does not support video playback.
        </video>
      </div>
    </div>
  );
}