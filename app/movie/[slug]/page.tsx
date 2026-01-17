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
    const [audioTracks, setAudioTracks] = useState<any[]>([])
    const [subtitleTracks, setSubtitleTracks] = useState<any[]>([])
    const [currentAudio, setCurrentAudio] = useState(-1)
    const [currentSubtitle, setCurrentSubtitle] = useState(-1)
    const hlsRef = useRef<Hls | null>(null)

    const initPlayer = () => {
        if (!slug) return

        const video = videoRef.current
        if (!video) return

        const host = window.location.hostname
        const src = `http://${host}:8080/hls/${slug}/movie.m3u8`

        if (Hls.isSupported()) {
            const hls = new Hls()
            hlsRef.current = hls
            hls.loadSource(src)
            hls.attachMedia(video)

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                setStatus('playing')
                video.play().catch(e => console.log('Autoplay blocked', e))
                setError('')
            })

            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (e, data) => {
                setAudioTracks(data.audioTracks)
                setCurrentAudio(hls.audioTrack)
            })

            hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (e, data) => {
                setSubtitleTracks(data.subtitleTracks)
                setCurrentSubtitle(hls.subtitleTrack)
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
            // Native HLS support (Safari/iOS) - Controls are native
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

    const changeAudio = (trackId: number) => {
        if (hlsRef.current) {
            hlsRef.current.audioTrack = trackId
            setCurrentAudio(trackId)
        }
    }

    const changeSubtitle = (trackId: number) => {
        if (hlsRef.current) {
            hlsRef.current.subtitleTrack = trackId
            setCurrentSubtitle(trackId)
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

            <div className="w-full max-w-6xl flex flex-col gap-4">
                <div className="w-full aspect-video bg-black relative shadow-2xl flex items-center justify-center">
                    <video
                        ref={videoRef}
                        controls
                        className={`w-full h-full ${status === 'playing' ? 'block' : 'hidden'}`}
                        poster={`http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:8080/hls/${slug}/poster.jpg`}
                    />

                    {status === 'loading' && (
                        <div className="text-center absolute inset-0 flex flex-col items-center justify-center bg-black/50 z-20">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-red-600 mx-auto mb-4"></div>
                            <p className="text-white text-xl">Processing Video... Please wait.</p>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="text-red-500 text-center p-4 bg-black/80 rounded absolute z-20">
                            <p className="text-xl font-bold mb-2">Error Playing Video</p>
                            <p>{error}</p>
                        </div>
                    )}
                </div>

                {/* Track Controls */}
                <div className="flex flex-wrap gap-4 px-4 py-2 bg-gray-900 rounded-lg">
                    {audioTracks.length > 1 && (
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400 font-bold">Audio:</span>
                            <select
                                value={currentAudio}
                                onChange={(e) => changeAudio(parseInt(e.target.value))}
                                className="bg-gray-800 text-white p-2 rounded border border-gray-700"
                            >
                                {audioTracks.map((track, i) => (
                                    <option key={i} value={i}>
                                        {track.name || track.lang || `Track ${i + 1}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {subtitleTracks.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400 font-bold">Subtitles:</span>
                            <select
                                value={currentSubtitle}
                                onChange={(e) => changeSubtitle(parseInt(e.target.value))}
                                className="bg-gray-800 text-white p-2 rounded border border-gray-700"
                            >
                                <option value={-1}>Off</option>
                                {subtitleTracks.map((track, i) => (
                                    <option key={i} value={i}>
                                        {track.name || track.lang || `Subtitle ${i + 1}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                <div className="px-4">
                    <h1 className="text-2xl font-bold text-white capitalize">{slug}</h1>
                </div>
            </div>
        </div>
    )
}
