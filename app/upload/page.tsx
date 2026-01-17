'use client'

import { useState } from 'react'

export default function UploadPage() {
    const [file, setFile] = useState<File | null>(null)
    const [title, setTitle] = useState('')
    const [desc, setDesc] = useState('')
    const [status, setStatus] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!file || !title) return

        setLoading(true)
        setStatus('Uploading...')

        try {
            // Use raw body upload to avoid FormData buffering
            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: {
                    'X-Upload-Title': encodeURIComponent(title),
                    'X-Upload-Desc': encodeURIComponent(desc),
                    'Content-Type': 'application/octet-stream', // Important to handle as raw
                },
                body: file,
                // @ts-ignore - 'duplex' is a new fetch option for streaming bodies
                duplex: 'half'
            })

            if (res.ok) {
                setStatus('Upload successful! Processing started. It may take a few minutes to appear.')
                setTitle('')
                setDesc('')
                setFile(null)
            } else {
                setStatus('Upload failed.')
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
