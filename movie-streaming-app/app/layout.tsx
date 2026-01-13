import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Home Movie Streaming',
  description: 'Local movie streaming application',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white min-h-screen">
        <nav className="bg-gray-800 border-b border-gray-700">
          <div className="container mx-auto px-4 py-4 flex justify-between items-center">
            <a href="/" className="text-2xl font-bold text-blue-500">
              🎬 Home Cinema
            </a>
            <a
              href="/upload"
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
            >
              Upload Movie
            </a>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
