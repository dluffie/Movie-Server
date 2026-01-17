'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Hls from 'hls.js'
import Link from 'next/link'

export default function PlayerPage() {
    const { slug } = useParams()
    const videoRef = useRef<HTMLVideoElement>(null)
    const [error, setError] = useState('')
    const [status, setStatus] = useState<'loading' | 'playing' | 'error'>('loading')
    const retryTimeout = useRef<NodeJS.Timeout | null>(null)

    const initPlayer = () => {
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
                setStatus('playing')
                video.play().catch(e => console.log('Autoplay blocked', e))
                setError('')
            })

            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log('Network error, retrying in 5s...')
                            setStatus('loading')
                            hls.destroy()
                            retryTimeout.current = setTimeout(initPlayer, 5000)
                            break
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('Media error, trying verification...')
                            hls.recoverMediaError()
                            break
                        default:
                            setStatus('error')
                            setError(`Stream error: ${data.details}`)
                            hls.destroy()
                            break
                    }
                }
            })
            return hls
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS support
            video.src = src
            video.addEventListener('loadedmetadata', () => {
                setStatus('playing')
                video.play()
            })
            video.addEventListener('error', () => {
                setStatus('loading')
                retryTimeout.current = setTimeout(initPlayer, 5000)
            })
            return null
        } else {
            setStatus('error')
            setError('HLS not supported in this browser.')
            return null
        }
    }

    useEffect(() => {
        const hlsInstance = initPlayer()

        return () => {
            if (hlsInstance) hlsInstance.destroy()
            if (retryTimeout.current) clearTimeout(retryTimeout.current)
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

            <div className="w-full max-w-6xl aspect-video bg-black relative shadow-2xl flex items-center justify-center">
                <video
                    ref={videoRef}
                    controls
                    className={`w-full h-full ${status === 'playing' ? 'block' : 'hidden'}`}
                    poster={`http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8080/hls/${slug}/poster.jpg`}
                />

                {status === 'loading' && (
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-red-600 mx-auto mb-4"></div>
                        <p className="text-white text-xl">Processing Video... Please wait.</p>
                        <p className="text-gray-400 text-sm mt-2">Checking stream status...</p>
                    </div>
                )}

                {status === 'error' && (
                    <div className="text-red-500 text-center p-4 bg-black/80 rounded">
                        <p className="text-xl font-bold mb-2">Error Playing Video</p>
                        <p>{error}</p>
                    </div>
                )}
            </div>

            <div className="max-w-6xl w-full mt-6 px-4">
                <h1 className="text-2xl font-bold text-white capitalize">{slug}</h1>
            </div>
        </div>
    )
}
