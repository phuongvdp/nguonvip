#!/bin/bash

# ============================================================
# SETUP SCRIPT - Nguồn Thể Thao VIP
# ============================================================
# Script này tự động setup project cho bạn
# Chạy: chmod +x SETUP.sh && ./SETUP.sh

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║   🚀 SETUP - Nguồn Thể Thao VIP                ║"
echo "║   Project: Sẵn sàng deploy!                    ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================
# Step 1: Check Node.js
# ============================================================
echo -e "${BLUE}[1/5]${NC} Checking Node.js..."

if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}⚠️  Node.js not found!${NC}"
    echo "Please install Node.js from: https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✅ Node.js $NODE_VERSION found${NC}"
echo ""

# ============================================================
# Step 2: Check npm
# ============================================================
echo -e "${BLUE}[2/5]${NC} Checking npm..."

if ! command -v npm &> /dev/null; then
    echo -e "${YELLOW}⚠️  npm not found!${NC}"
    exit 1
fi

NPM_VERSION=$(npm -v)
echo -e "${GREEN}✅ npm $NPM_VERSION found${NC}"
echo ""

# ============================================================
# Step 3: Install dependencies
# ============================================================
echo -e "${BLUE}[3/5]${NC} Installing dependencies..."
echo "This may take a few minutes..."
echo ""

npm install

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  npm install failed!${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# ============================================================
# Step 4: Build test
# ============================================================
echo -e "${BLUE}[4/5]${NC} Testing build..."
echo ""

npm run build

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Build failed!${NC}"
    echo "Please check error message above"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Build successful${NC}"
echo ""

# ============================================================
# Step 5: Verify imports
# ============================================================
echo -e "${BLUE}[5/5]${NC} Verifying imports..."
echo ""

WRONG_IMPORTS=$(grep -r "@/src/services/" pages/api/ 2>/dev/null | wc -l)

if [ "$WRONG_IMPORTS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $WRONG_IMPORTS incorrect imports!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All imports are correct${NC}"
echo ""

# ============================================================
# Success!
# ============================================================
echo "╔════════════════════════════════════════════════╗"
echo "║   ✅ SETUP COMPLETE!                          ║"
echo "║   Ready to deploy! 🚀                         ║"
echo "╚════════════════════════════════════════════════╝"
echo ""

echo "📚 Next Steps:"
echo ""
echo "1️⃣  LOCAL DEVELOPMENT (Optional)"
echo "   npm run dev"
echo "   Open: http://localhost:3000"
echo ""
echo "2️⃣  DEPLOY TO VERCEL"
echo "   git add ."
echo "   git commit -m 'feat: Ready to deploy'"
echo "   git push origin main"
echo ""
echo "3️⃣  VERCEL WILL AUTO-DEPLOY"
echo "   Wait 2-5 minutes"
echo "   Check: https://vercel.com/dashboard"
echo ""
echo "4️⃣  WEBSITE LIVE! 🎉"
echo ""
echo "📖 For more info, read: DEPLOYMENT_GUIDE.md"
echo ""
