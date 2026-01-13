import { Routes, Route, Link } from 'react-router-dom'
import HomePage from './pages/Home'
import MoviePage from './pages/Movie'
import UploadPage from './pages/Upload'

export default function App() {
  return (
    <div className="bg-gray-900 min-h-screen text-white">
      <nav className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between">
          <Link to="/" className="text-2xl font-bold text-blue-500">
            🎬 Home Cinema
          </Link>
          <Link to="/upload" className="bg-blue-600 px-4 py-2 rounded">
            Upload Movie
          </Link>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/movie/:slug" element={<MoviePage />} />
        <Route path="/upload" element={<UploadPage />} />
      </Routes>
    </div>
  )
}
