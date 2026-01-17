'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Movie = {
  title: string
  slug: string
  description: string
  poster: string
}

export default function Home() {
  const [movies, setMovies] = useState<Movie[]>([])
  const [search, setSearch] = useState('')
  const [streamHost, setStreamHost] = useState('')

  useEffect(() => {
    // Determine the streaming host (same as current host but port 8080)
    if (typeof window !== 'undefined') {
      setStreamHost(`http://${window.location.hostname}:8080`)
    }

    fetch('/api/movies')
      .then(res => res.json())
      .then(data => setMovies(data.movies))
  }, [])

  const filteredMovies = movies.filter(m =>
    m.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
          <h1 className="text-4xl font-extrabold text-red-600 tracking-tighter">LOCFLIX</h1>

          <div className="flex gap-4 w-full md:w-auto">
            <input
              type="text"
              placeholder="Search movies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-4 py-2 rounded-full bg-gray-800 border border-gray-700 focus:outline-none focus:border-red-600 w-full md:w-64"
            />
            <Link
              href="/upload"
              className="px-6 py-2 bg-red-600 rounded-full font-semibold hover:bg-red-700 transition whitespace-nowrap"
            >
              Upload
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {filteredMovies.map((movie) => (
            <Link key={movie.slug} href={`/movie/${movie.slug}`} className="group relative block bg-gray-900 rounded-lg overflow-hidden transition transform hover:scale-105 hover:z-10 shadow-lg">
              <div className="aspect-[2/3] bg-gray-800 relative">
                {/* We try to load the poster from Nginx */}
                <img
                  src={`${streamHost}/hls/${movie.slug}/poster.jpg`}
                  alt={movie.title}
                  className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition"
                  onError={(e) => {
                    // Fallback if poster missing
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNDQ0IiBzdHJva2Utd2lkdGg9IjIiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIHJ5PSIyIi8+PGNpcmNsZSBjeD0iOC41IiBjeT0iOC41IiByPSIxLjUiLz48cG9seWxpbmUgcG9pbnRzPSIyMSAxNSAxNiAxMCA1IDIxIi8+PC9zdmc+'
                  }}
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />

                <div className="absolute bottom-0 left-0 p-4 w-full">
                  <h3 className="font-bold text-lg truncate">{movie.title}</h3>
                  <p className="text-xs text-gray-400 line-clamp-2">{movie.description}</p>
                </div>
              </div>
            </Link>
          ))}

          {filteredMovies.length === 0 && (
            <div className="col-span-full text-center text-gray-500 py-12">
              No movies found. Upload some!
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
