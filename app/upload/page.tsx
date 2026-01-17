'use client'

import { useState } from 'react'

export default function UploadPage() {
    const [file, setFile] = useState<File | null>(null)
    const [poster, setPoster] = useState<File | null>(null)
    const [title, setTitle] = useState('')
    const [desc, setDesc] = useState('')
    const [status, setStatus] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!file || !title) return

        setLoading(true)
        setStatus('Uploading Video...')

        try {
            // 1. Upload Video
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: {
                    'X-Upload-Title': encodeURIComponent(title),
                    'X-Upload-Desc': encodeURIComponent(desc),
                    'X-Skip-Poster-Gen': poster ? 'true' : 'false',
                    'Content-Type': 'application/octet-stream',
                },
                body: file,
                // @ts-ignore
                duplex: 'half'
            })

            if (res.ok) {
                const data = await res.json()
                const slug = data.slug

                // 2. Upload Poster (if selected)
                if (poster && slug) {
                    setStatus('Video uploaded. Uploading Poster...')
                    const posterRes = await fetch(`/api/upload/poster?slug=${slug}`, {
                        method: 'POST',
                        body: poster
                    })
                    if (!posterRes.ok) {
                        console.error('Poster upload failed')
                        setStatus('Video uploaded, but Poster upload failed.')
                    } else {
                        setStatus('Upload successful! Processing started.')
                    }
                } else {
                    setStatus('Upload successful! Processing started. It may take a few minutes to appear.')
                }

                setTitle('')
                setDesc('')
                setFile(null)
                setPoster(null)
            } else if (res.status === 429) {
                setStatus('Server is busy processing another video. Please wait a few minutes and try again.')
            } else {
                const data = await res.json().catch(() => ({}))
                setStatus(`Upload failed: ${data.message || data.error || 'Unknown error'}`)
            }
        } catch (err) {
            console.error(err)
            setStatus('Network error.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <h1 className="text-3xl font-bold mb-8 text-center text-red-500">Upload Movie</h1>

            <form onSubmit={handleSubmit} className="max-w-xl mx-auto space-y-6 bg-gray-800 p-6 rounded-lg shadow-lg">
                <div>
                    <label className="block mb-2 font-medium">Movie Title</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-red-500"
                        required
                        placeholder="e.g. Interstellar"
                    />
                </div>

                <div>
                    <label className="block mb-2 font-medium">Description</label>
                    <textarea
                        value={desc}
                        onChange={(e) => setDesc(e.target.value)}
                        className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:border-red-500"
                        rows={4}
                        placeholder="Movie plot..."
                    />
                </div>

                <div>
                    <label className="block mb-2 font-medium">Poster Image (Optional)</label>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setPoster(e.target.files?.[0] || null)}
                        className="w-full p-2 bg-gray-700 rounded border border-gray-600"
                    />
                    <p className="text-xs text-gray-400 mt-1">Leave empty to auto-generate from video.</p>
                </div>

                <div>
                    <label className="block mb-2 font-medium">Video File (MP4/MKV)</label>
                    <input
                        type="file"
                        accept="video/*"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        className="w-full p-2 bg-gray-700 rounded border border-gray-600"
                        required
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className={`w-full p-3 rounded font-bold text-lg transition ${loading ? 'bg-gray-600 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'
                        }`}
                >
                    {loading ? 'Uploading...' : 'Upload Movie'}
                </button>

                {status && (
                    <div className={`text-center mt-4 font-semibold ${status.includes('failed') || status.includes('error') ? 'text-red-400' : 'text-green-400'}`}>
                        {status}
                    </div>
                )}
            </form>
        </div>
    )
}
