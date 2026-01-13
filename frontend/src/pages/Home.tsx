import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Movie {
  title: string
  slug: string
  duration: string
  posterUrl?: string
}

export default function HomePage() {
  const [movies, setMovies] = useState<Movie[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('http://localhost:4000/api/movies')
      .then(res => res.json())
      .then(data => setMovies(data.movies))
  }, [])

  const filtered = movies.filter(m =>
    m.title.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6">
      <input
        className="search-bar mb-8"
        placeholder="Search movies..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {filtered.map(movie => (
          <Link key={movie.slug} to={`/movie/${movie.slug}`} className="movie-card">
            <div className="movie-poster flex items-center justify-center">
              🎬
            </div>
            <div className="p-4">
              <h3 className="font-semibold">{movie.title}</h3>
              <p className="text-gray-400 text-sm">{movie.duration}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
