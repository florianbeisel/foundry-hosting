# Refactored Discord Bot Demo

## 🚀 Quick Start

### Prerequisites
1. Node.js 18+ installed
2. Discord bot token
3. AWS credentials (optional for local testing)

### Setup
1. Clone the repository and navigate to the discord directory:
   ```bash
   cd discord
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment file:
   ```bash
   cp src/.env.example .env
   ```

4. Edit `.env` with your Discord bot token:
   ```bash
   DISCORD_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_client_id_here
   # Optional AWS settings for full functionality
   # AWS_REGION=us-east-1
   # LAMBDA_FUNCTION_NAME=foundry-vtt-instance-management
   ```

### Running the Bot

#### Refactored Version (Default)
```bash
npm start
# or for development with auto-reload
npm run dev
```

#### Legacy Version (For Comparison)
```bash
npm run start:legacy
# or for development
npm run dev:legacy
```

## 🎮 Testing the Refactored Bot

### Available Commands
- `/foundry user dashboard` - Show your instance dashboard
- `/foundry user help` - Display help information
- `/foundry user license-sharing` - License sharing management (placeholder)
- `/foundry admin overview` - Admin system overview (placeholder)
- `/foundry admin test-log <message>` - Test the logging system

### Demo Features

1. **Clean Modular Structure** 
   - Compare file sizes: `wc -l src/index.js index-legacy.js`
   - Navigate the organized src/ directory structure

2. **Working Dashboard**
   - Run `/foundry user dashboard`
   - See the clean, modular implementation

3. **Interactive Buttons**
   - If you have AWS configured, buttons will work for instance management
   - Without AWS, you'll see friendly error messages

4. **Logging System**
   - The bot creates a `#foundry-bot-logs` channel
   - Test with `/foundry admin test-log "Hello from refactored bot!"`

5. **Error Handling**
   - Try various commands to see graceful error handling
   - Errors are isolated to specific modules

## 📊 Architecture Comparison

### Before (Legacy)
```
discord/
├── index-legacy.js      (6,943 lines)
├── commands/
│   └── foundry-legacy.js (1,543 lines)
```

### After (Refactored)
```
discord/src/
├── index.js             (75 lines)
├── commands/
│   └── foundry.js       (183 lines)
├── bot/ handlers/ services/ ui/ utils/
    (25+ focused modules)
```

## 🔍 What to Look For

### Code Quality
- **Small, focused files** instead of massive monoliths
- **Clear separation of concerns** across directories
- **Consistent error handling** patterns
- **Modular imports** and exports

### Developer Experience
- **Easy navigation** - find any functionality quickly
- **Clear file structure** - know exactly where to add new features
- **Better debugging** - stack traces point to specific, small files
- **Testable components** - each module can be tested in isolation

### Runtime Behavior
- **Faster startup** - modular loading
- **Better error isolation** - one module error doesn't crash everything
- **Cleaner logs** - structured logging to Discord
- **Responsive interactions** - proper async handling

## 🛠️ Development Workflow

### Adding New Commands
1. Create handler in `src/commands/user/` or `src/commands/admin/`
2. Add import to `src/commands/foundry.js`
3. Add route in the command execution logic

### Adding New Services
1. Create service in `src/services/`
2. Export functions for other modules to use
3. Import where needed

### Debugging
- Check `#foundry-bot-logs` channel for structured logs
- Use file names to quickly locate issues
- Set breakpoints in specific modules

## 🎯 Benefits Demonstrated

1. **Maintainability**: 99% reduction in main file size
2. **Modularity**: Clear separation of concerns
3. **Extensibility**: Easy to add new features
4. **Debuggability**: Clear error attribution
5. **Professional Structure**: Industry best practices

## 🚧 Current Limitations

This is a demonstration of the architecture. Some features are placeholders:
- Full instance management requires AWS configuration
- Registration system is not yet implemented
- Some admin commands show placeholder messages

The goal is to show the clean architecture and development experience improvements!

## 🎉 Next Steps

1. **Try both versions** to feel the difference
2. **Explore the code structure** in your IDE
3. **Add a new command** to see how easy it is
4. **Check the logs** to see the improved debugging experience

The refactored version provides a foundation for:
- ✅ **Easy maintenance**
- ✅ **Rapid feature development** 
- ✅ **Team collaboration**
- ✅ **Professional code quality**