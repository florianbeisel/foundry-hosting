#!/bin/bash

# Migration script for refactoring Discord bot
# This script backs up the old index.js and replaces it with the refactored version

echo "🚀 Starting Discord bot refactoring migration..."

# Create backup of original index.js
if [ -f "index.js" ]; then
    echo "📦 Creating backup of original index.js..."
    cp index.js index.js.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Backup created"
else
    echo "❌ Error: index.js not found!"
    exit 1
fi

# Check if refactored version exists
if [ -f "index.refactored.js" ]; then
    echo "📝 Found refactored version..."
else
    echo "❌ Error: index.refactored.js not found!"
    exit 1
fi

# Replace index.js with refactored version
echo "🔄 Replacing index.js with refactored version..."
mv index.refactored.js index.js
echo "✅ Replacement complete"

# Verify all required directories exist
echo "📁 Verifying directory structure..."
required_dirs=("config" "utils" "services" "events" "models" "handlers")
for dir in "${required_dirs[@]}"; do
    if [ -d "$dir" ]; then
        echo "  ✓ $dir directory exists"
    else
        echo "  ❌ $dir directory missing!"
        exit 1
    fi
done

# Verify all required files exist
echo "📄 Verifying required files..."
required_files=(
    "config/constants.js"
    "utils/permissions.js"
    "utils/formatting.js"
    "utils/components.js"
    "utils/channels.js"
    "utils/dashboard.js"
    "utils/stats.js"
    "utils/admin.js"
    "services/dynamodb.js"
    "services/lambda.js"
    "services/monitoring.js"
    "services/discord-client.js"
    "events/ready.js"
    "events/interactionCreate.js"
    "handlers/buttonHandlers.js"
    "handlers/adminHandlers.js"
    "handlers/modalHandlers.js"
    "handlers/selectMenuHandlers.js"
)

all_files_exist=true
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✓ $file exists"
    else
        echo "  ❌ $file missing!"
        all_files_exist=false
    fi
done

if [ "$all_files_exist" = false ]; then
    echo "❌ Some required files are missing. Migration aborted."
    echo "🔄 Restoring original index.js..."
    mv index.js index.refactored.js
    cp index.js.backup.$(date +%Y%m%d_%H%M%S) index.js
    exit 1
fi

echo "✅ All files verified successfully!"
echo ""
echo "🎉 Migration completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Test the bot thoroughly to ensure backward compatibility"
echo "2. Monitor logs for any errors"
echo "3. If issues arise, restore from backup: index.js.backup.*"
echo ""
echo "💡 To restore the original version:"
echo "   cp index.js.backup.<timestamp> index.js"