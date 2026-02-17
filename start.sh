#!/bin/bash
# ===================================
# LOCFLIX - Termux Startup Script
# Optimized for 2GB RAM devices
# ===================================

echo "🎬 LOCFLIX - Starting Local Movie Server..."

# Limit Node.js memory to 256MB (safe for 2GB RAM)
export NODE_OPTIONS="--max-old-space-size=256"

# Create movies directory if needed
mkdir -p ./movies

# Check if build exists
if [ ! -d ".next" ]; then
    echo "📦 First run — building production bundle..."
    echo "  (This takes 2-3 minutes, but uses less RAM afterwards)"
    npx next build
    
    if [ $? -ne 0 ]; then
        echo "❌ Build failed! Try: npm run dev (uses more RAM)"
        exit 1
    fi
fi

echo ""
echo "✅ Starting production server..."
echo "   Open: http://localhost:3000"
echo "   Network: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '0.0.0.0'):3000"
echo ""
echo "   No Nginx needed! Everything runs through Next.js."
echo ""

# Start production server (uses much less RAM than dev)
npx next start --hostname 0.0.0.0 --port 3000
