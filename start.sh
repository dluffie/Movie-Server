#!/bin/bash
# ===================================
# LOCFLIX - Termux Startup Script
# Optimized for 2GB RAM devices
# ===================================

echo "🎬 LOCFLIX - Starting Local Movie Server..."

# Limit Node.js memory
export NODE_OPTIONS="--max-old-space-size=256"

# Create movies directory if needed
mkdir -p ./movies

# Check for valid build
if [ ! -f ".next/BUILD_ID" ]; then
    echo ""
    echo "⚠️  No production build found!"
    echo ""
    echo "  Build on your PC first, then push to Termux:"
    echo "    PC:     npm run build && git add -A && git commit -m 'build' && git push"
    echo "    Termux: git pull && bash start.sh"
    echo ""
    exit 1
fi

# Get local IP
LOCAL_IP=$(ip route get 1 2>/dev/null | awk '{print $NF;exit}' || hostname -I 2>/dev/null | awk '{print $1}' || echo "0.0.0.0")

echo ""
echo "✅ Starting production server..."
echo "   Local:   http://localhost:3000"
echo "   Network: http://${LOCAL_IP}:3000"
echo ""

# Start production server
npx next start --hostname 0.0.0.0 --port 3000
