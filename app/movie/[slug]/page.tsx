'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Hls from 'hls.js'
import Link from 'next/link'

export default function PlayerPage() {
    const { slug } = useParams()
    const videoRef = useRef<HTMLVideoElement>(null)
    const [error, setError] = useState('')

    useEffect(() => {
        if (!slug) return

        const video = videoRef.current
        if (!video) return

        const host = window.location.hostname
        const src = `http://${host}:8080/hls/${slug}/movie.m3u8`

        if (Hls.isSupported()) {
            const hls = new Hls()
            hls.loadSource(src)
            hls.attachMedia(video)
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play().catch(e => console.log('Autoplay blocked', e))
            })
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    setError(`Stream error: ${data.details}`)
                }
            })
            return () => {
                hls.destroy()
            }
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support (Safari/iOS)
            video.src = src
            video.addEventListener('loadedmetadata', () => {
                video.play()
            })
        } else {
            setError('HLS not supported in this browser.')
        }
    }, [slug])

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this movie permanently? This cannot be undone.')) return

        try {
            const res = await fetch(`/api/movie/${slug}`, { method: 'DELETE' })
            if (res.ok) {
                window.location.href = '/'
            } else {
                alert('Failed to delete movie.')
            }
        } catch (e) {
            alert('Error deleting movie')
        }
    }

    return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center relative">
            <div className="absolute top-6 left-6 z-10 flex gap-4">
                <Link href="/" className="text-white bg-gray-800 px-4 py-2 rounded hover:bg-gray-700">
                    ← Back to Home
                </Link>
            </div>

            <div className="absolute top-6 right-6 z-10">
                <button
                    onClick={handleDelete}
                    className="text-white bg-red-800 px-4 py-2 rounded hover:bg-red-900 border border-red-700"
                >
                    DELETE MOVIE
                </button>
            </div>

            <div className="w-full max-w-6xl aspect-video bg-black relative shadow-2xl">
                <video
                    ref={videoRef}
                    controls
                    className="w-full h-full"
                    poster={`http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8080/hls/${slug}/poster.jpg`}
                />
                {error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-red-500 z-20">
                        <p className="text-xl font-bold">{error}</p>
                    </div>
                )}
            </div>

            <div className="max-w-6xl w-full mt-6 px-4">
                <h1 className="text-2xl font-bold text-white capitalize">{slug}</h1>
            </div>
        </div>
    )
}
