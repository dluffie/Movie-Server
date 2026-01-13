'use client';

import { useState } from 'react';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!file || !title) {
      setMessage('Please provide a file and title');
      return;
    }

    setUploading(true);
    setMessage('Uploading and processing...');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('description', description);
    formData.append('duration', duration);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setMessage('Movie uploaded successfully! Redirecting...');
        setTimeout(() => {
          window.location.href = '/';
        }, 2000);
      } else {
        setMessage(`Error: ${data.error || 'Upload failed'}`);
      }
    } catch (error) {
      setMessage('Upload failed. Please try again.');
      console.error(error);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Upload Movie</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Movie File (MP4/MKV) *
          </label>
          <input
            type="file"
            accept="video/mp4,video/x-matroska"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Duration (e.g., "2h 30m")
          </label>
          <input
            type="text"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="2h 30m"
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg"
          />
        </div>

        <button
          type="submit"
          disabled={uploading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-6 py-3 rounded-lg font-semibold transition"
        >
          {uploading ? 'Processing...' : 'Upload Movie'}
        </button>

        {message && (
          <p
            className={`text-center ${
              message.includes('Error') ? 'text-red-500' : 'text-green-500'
            }`}
          >
            {message}
          </p>
        )}
      </form>

      <div className="mt-8 p-4 bg-gray-800 rounded-lg">
        <h3 className="font-semibold mb-2">Note:</h3>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>• Upload will convert video to HLS format using FFmpeg</li>
          <li>• Large files may take several minutes to process</li>
          <li>• Supported formats: MP4, MKV</li>
        </ul>
      </div>
    </div>
  );
}