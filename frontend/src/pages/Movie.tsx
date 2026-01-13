import { useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

export default function MoviePage() {
  const { slug } = useParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [movie, setMovie] = useState<any>(null)

  useEffect(() => {
    fetch('http://localhost:4000/api/movies')
      .then(res => res.json())
      .then(data => {
        const found = data.movies.find((m: any) => m.slug === slug)
        setMovie(found)
      })
  }, [slug])

  useEffect(() => {
    if (!movie || !videoRef.current) return

    const url = `http://localhost:8080/hls/${movie.slug}/movie.m3u8`

    if (Hls.isSupported()) {
      const hls = new Hls()
      hls.loadSource(url)
      hls.attachMedia(videoRef.current)
      return () => hls.destroy()
    } else {
      videoRef.current.src = url
    }
  }, [movie])

  if (!movie) return <p className="p-6">Loading...</p>

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">{movie.title}</h1>
      <video ref={videoRef} controls className="w-full bg-black rounded" />
    </div>
  )
}
