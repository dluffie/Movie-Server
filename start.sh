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

# Check for a VALID production build (BUILD_ID must exist)
if [ ! -f ".next/BUILD_ID" ]; then
    echo ""
    echo "⚠️  No valid production build found!"
    echo ""
    echo "   Your phone doesn't have enough RAM to build."
    echo "   Build on your PC first, then push to Termux:"
    echo ""
    echo "   On PC:"
    echo "     cd Movie-Server"
    echo "     npm run build"
    echo "     git add -A && git commit -m 'build' && git push"
    echo ""
    echo "   On Termux:"
    echo "     cd ~/Movie-Server && git pull"
    echo "     bash start.sh"
    echo ""
    echo "   Alternatively, try building here (may crash on 2GB RAM):"
    echo "     NODE_OPTIONS='--max-old-space-size=384' npx next build"
    echo ""
    exit 1
fi

# Get local IP
LOCAL_IP=$(ip route get 1 2>/dev/null | awk '{print $NF;exit}' || hostname -I 2>/dev/null | awk '{print $1}' || echo "0.0.0.0")

echo ""
echo "✅ Starting production server..."
echo "   Open: http://localhost:3000"
echo "   Network: http://${LOCAL_IP}:3000"
echo ""
echo "   No Nginx needed! Everything runs through Next.js."
echo ""

# Start the standalone server (uses minimal RAM)
if [ -f ".next/standalone/server.js" ]; then
    # Standalone mode (best for Termux)
    cp -r .next/static .next/standalone/.next/static 2>/dev/null
    cp -r public .next/standalone/public 2>/dev/null
    node .next/standalone/server.js
else
    # Regular production start
    npx next start --hostname 0.0.0.0 --port 3000
fi
