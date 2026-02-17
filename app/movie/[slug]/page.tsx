'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Hls from 'hls.js'
import Link from 'next/link'

type VerifyResult = {
    valid: boolean
    status: string
    error?: string
    totalSegments?: number
    validSegments?: number
    invalidSegments?: string[]
    totalSizeMB?: number
}

type ProcessingStatus = {
    status: 'processing' | 'ready' | 'error' | 'not-found'
    progress?: number
    mode?: string
    error?: string
    verified?: boolean
}

export default function PlayerPage() {
    const { slug } = useParams()
    const videoRef = useRef<HTMLVideoElement>(null)
    const [playerStatus, setPlayerStatus] = useState<'checking' | 'loading' | 'playing' | 'error'>('checking')
    const [statusText, setStatusText] = useState('Checking stream...')
    const [error, setError] = useState('')
    const [audioTracks, setAudioTracks] = useState<any[]>([])
    const [currentAudio, setCurrentAudio] = useState(-1)
    const [verifyInfo, setVerifyInfo] = useState<VerifyResult | null>(null)
    const hlsRef = useRef<Hls | null>(null)
    const retryTimeout = useRef<NodeJS.Timeout | null>(null)
    const pollTimeout = useRef<NodeJS.Timeout | null>(null)

    // Step 1: Check if stream is ready before trying to play
    const checkStreamReady = async (): Promise<boolean> => {
        try {
            // First check processing status
            const statusRes = await fetch(`/api/movie/${slug}/status`)
            const statusData: ProcessingStatus = await statusRes.json()

            if (statusData.status === 'processing') {
                setPlayerStatus('loading')
                setStatusText(`Converting: ${statusData.progress || 0}% (${statusData.mode || 'processing'})`)
                return false
            }

            if (statusData.status === 'error') {
                setPlayerStatus('error')
                setError(statusData.error || 'Conversion failed')
                return false
            }

            if (statusData.status === 'not-found') {
                setPlayerStatus('loading')
                setStatusText('Waiting for processing to start...')
                return false
            }

            // Stream is "ready" — now verify integrity
            try {
                const verifyRes = await fetch(`/api/movie/${slug}/verify`)
                const verifyData: VerifyResult = await verifyRes.json()
                setVerifyInfo(verifyData)

                if (!verifyData.valid) {
                    if (verifyData.status === 'incomplete') {
                        setPlayerStatus('loading')
                        setStatusText('Stream still being written...')
                        return false
                    }
                    // Show warning but still try to play
                    console.warn('Stream verification issues:', verifyData)
                }
            } catch {
                // Verify endpoint failed — not critical, still try to play
                console.warn('Could not verify stream, attempting playback anyway')
            }

            return true
        } catch {
            setPlayerStatus('loading')
            setStatusText('Checking stream status...')
            return false
        }
    }

    // Step 2: Initialize HLS player
    const initPlayer = () => {
        if (!slug) return

        const video = videoRef.current
        if (!video) return

        // Use self-served streams (no Nginx needed!)
        const src = `/api/stream/${slug}/movie.m3u8`

        if (Hls.isSupported()) {
            const hls = new Hls({
                debug: false,
                // Balanced for low-RAM devices
                maxBufferLength: 30,              // 30s forward buffer
                maxMaxBufferLength: 60,           // 60s max
                maxBufferSize: 30 * 1024 * 1024,  // 30MB buffer
                maxBufferHole: 0.5,
                startFragPrefetch: true,          // Prefetch first fragment
                enableWorker: true,               // Use web worker for transmux
                lowLatencyMode: false,            // VOD, not live
                progressive: true,               // Load segments progressively
            })
            hlsRef.current = hls

            hls.loadSource(src)
            hls.attachMedia(video)

            hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
                console.log('HLS Manifest Parsed:', {
                    levels: data.levels?.length,
                    audioTracks: data.audioTracks?.length,
                })

                if (data.audioTracks && data.audioTracks.length > 0) {
                    setAudioTracks(data.audioTracks)
                    setCurrentAudio(hls.audioTrack)
                }

                setPlayerStatus('playing')
                setStatusText('')
                video.play().catch(e => console.log('Autoplay blocked:', e.message))
            })

            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
                setAudioTracks(data.audioTracks)
                setCurrentAudio(hls.audioTrack)
            })

            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log('HLS network error, retrying in 3s...')
                            setPlayerStatus('loading')
                            setStatusText('Network error, retrying...')
                            hls.destroy()
                            hlsRef.current = null
                            retryTimeout.current = setTimeout(() => startPlayback(), 3000)
                            break
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('HLS media error, attempting recovery...')
                            hls.recoverMediaError()
                            break
                        default:
                            setPlayerStatus('error')
                            setError(`Stream error: ${data.details}`)
                            hls.destroy()
                            hlsRef.current = null
                            break
                    }
                }
            })

            return hls
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari/iOS)
            video.src = src
            video.addEventListener('loadedmetadata', () => {
                setPlayerStatus('playing')
                video.play()
            })
            video.addEventListener('error', () => {
                setPlayerStatus('loading')
                setStatusText('Retrying...')
                retryTimeout.current = setTimeout(() => startPlayback(), 3000)
            })
            return null
        } else {
            setPlayerStatus('error')
            setError('HLS not supported in this browser.')
            return null
        }
    }

    // Main flow: check → play (with polling if not ready)
    const startPlayback = async () => {
        const ready = await checkStreamReady()
        if (ready) {
            initPlayer()
        } else {
            // Poll every 5 seconds
            pollTimeout.current = setTimeout(() => startPlayback(), 5000)
        }
    }

    const changeAudio = (trackId: number) => {
        if (hlsRef.current) {
            hlsRef.current.audioTrack = trackId
            setCurrentAudio(trackId)
        }
    }

    useEffect(() => {
        startPlayback()

        return () => {
            if (hlsRef.current) hlsRef.current.destroy()
            if (retryTimeout.current) clearTimeout(retryTimeout.current)
            if (pollTimeout.current) clearTimeout(pollTimeout.current)
        }
    }, [slug])

    const handleDelete = async () => {
        if (!confirm('Delete this movie permanently?')) return
        try {
            const res = await fetch(`/api/movie/${slug}`, { method: 'DELETE' })
            if (res.ok) window.location.href = '/'
            else alert('Failed to delete.')
        } catch { alert('Error deleting movie') }
    }

    return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center relative">
            <div className="absolute top-6 left-6 z-10">
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
                {/* Video Player */}
                <div className="w-full aspect-video bg-black relative shadow-2xl flex items-center justify-center">
                    <video
                        ref={videoRef}
                        controls
                        playsInline
                        className={`w-full h-full ${playerStatus === 'playing' ? 'block' : 'hidden'}`}
                        poster={`/api/stream/${slug}/poster.jpg`}
                    />

                    {playerStatus === 'checking' && (
                        <div className="text-center absolute inset-0 flex flex-col items-center justify-center bg-black z-20">
                            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
                            <p className="text-white text-lg">Checking stream...</p>
                        </div>
                    )}

                    {playerStatus === 'loading' && (
                        <div className="text-center absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
                            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-red-600 mb-4"></div>
                            <p className="text-white text-xl">{statusText}</p>
                            <p className="text-gray-400 text-sm mt-2">Auto-refreshing every 5 seconds...</p>
                        </div>
                    )}

                    {playerStatus === 'error' && (
                        <div className="text-red-500 text-center p-6 bg-black/90 rounded absolute z-20">
                            <p className="text-xl font-bold mb-2">Error</p>
                            <p>{error}</p>
                            <button
                                onClick={() => { setPlayerStatus('checking'); startPlayback() }}
                                className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                            >
                                Retry
                            </button>
                        </div>
                    )}
                </div>

                {/* Audio Track Controls */}
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
                                        {track.name || track.lang || `Audio ${i + 1}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Integrity Badge */}
                    {verifyInfo && (
                        <div className="flex items-center gap-2 ml-auto">
                            <span className={`text-xs px-2 py-1 rounded ${verifyInfo.valid ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'
                                }`}>
                                {verifyInfo.valid
                                    ? `✓ Verified (${verifyInfo.totalSegments} segments, ${verifyInfo.totalSizeMB}MB)`
                                    : `⚠ ${verifyInfo.error || 'Issues detected'}`
                                }
                            </span>
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
