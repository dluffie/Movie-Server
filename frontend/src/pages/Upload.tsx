import { useState } from 'react'

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')

  async function upload(e: any) {
    e.preventDefault()
    if (!file || !title) return

    const form = new FormData()
    form.append('file', file)
    form.append('title', title)

    await fetch('http://localhost:4000/api/upload', {
      method: 'POST',
      body: form,
    })

    alert('Uploaded!')
  }

  return (
    <form onSubmit={upload} className="p-6 max-w-xl mx-auto space-y-4">
      <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} />
      <input
        className="w-full p-2 bg-gray-800 rounded"
        placeholder="Movie title"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />
      <button className="bg-blue-600 px-4 py-2 rounded">Upload</button>
    </form>
  )
}
