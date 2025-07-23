#!/bin/bash

# Discord Bot Migration Script
# This script helps migrate from the monolithic version to the refactored version

echo "🔄 Starting Discord Bot Migration to Refactored Version"
echo "======================================================"

# Create backup of current version
echo "📦 Creating backup of current version..."
cp index.js index.js.backup
cp commands/foundry.js commands/foundry.js.backup
echo "✅ Backup created (index.js.backup, commands/foundry.js.backup)"

# Check if refactored version exists
if [ ! -d "src" ]; then
    echo "❌ Refactored version not found. Please ensure src/ directory exists."
    exit 1
fi

# Copy environment files
echo "⚙️ Copying environment configuration..."
if [ -f ".env" ]; then
    cp .env src/.env
    echo "✅ Environment file copied to src/"
else
    echo "⚠️ No .env file found. Please create one in src/ directory."
fi

# Install dependencies for refactored version
echo "📦 Installing dependencies for refactored version..."
cp package-refactored.json src/package.json
cd src
npm install
cd ..

echo ""
echo "🎉 Migration Setup Complete!"
echo ""
echo "Next Steps:"
echo "1. Review the refactored code in src/ directory"
echo "2. Test the new version: cd src && npm run dev"
echo "3. Update your deployment scripts to use src/index.js"
echo "4. Complete any remaining feature migrations"
echo ""
echo "📚 See REFACTORING_README.md for detailed information"
echo ""
echo "🔧 To run the refactored version:"
echo "   cd src"
echo "   npm start"
echo ""
echo "⚡ To run in development mode:"
echo "   cd src"
echo "   npm run dev"