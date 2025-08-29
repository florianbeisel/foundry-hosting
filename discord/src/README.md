# Foundry VTT Discord Bot - Refactored Architecture

This directory contains the refactored Discord bot with a clean, modular architecture.

## 📁 Structure

```
src/
├── core/                    # Core bot components
│   ├── bot.js              # Main Bot class and orchestration
│   ├── config-manager.js   # Configuration management
│   ├── state-manager.js    # Bot state and DynamoDB integration
│   ├── guild-manager.js    # Guild permissions and utilities
│   └── interaction-handler.js # Main interaction routing
├── services/               # Service layer
│   ├── lambda-service.js   # AWS Lambda API client
│   └── discord-service.js  # Discord API operations
├── handlers/               # Feature-specific handlers
│   ├── commands/
│   │   └── foundry-command.js
│   └── interactions/
│       ├── button-handler.js
│       ├── modal-handler.js
│       └── select-menu-handler.js
├── components/             # Reusable UI components
│   ├── embeds/
│   │   ├── registration-embed.js
│   │   └── status-embed.js
│   └── buttons/
│       └── instance-buttons.js
└── utils/                  # Utility functions
    ├── logger.js          # Structured logging
    └── error-handler.js   # Error handling and reporting
```

## 🏗️ Architecture Principles

### 1. **Single Responsibility**

Each class has one clear purpose:

- `Bot`: Orchestrates components and manages lifecycle
- `LambdaService`: All AWS Lambda communication
- `DiscordService`: All Discord API operations
- `StateManager`: Bot state and persistence

### 2. **Dependency Injection**

Services receive their dependencies explicitly, making testing easier:

```javascript
const bot = new Bot();
await bot.initialize(); // Sets up all dependencies
```

### 3. **Clean Separation**

- **Business Logic**: Lives in Lambda (not in bot)
- **UI Logic**: Lives in Discord bot (embeds, buttons, etc.)
- **State Management**: Centralized in StateManager
- **Configuration**: Centralized in ConfigManager

### 4. **Error Handling**

Centralized error handling with proper logging and user feedback:

```javascript
try {
  await this.lambdaService.startInstance(userId);
} catch (error) {
  await ErrorHandler.handleButtonError(interaction, error, userId);
}
```

## 🔄 Migration Status

### ✅ Completed

- [x] Core bot structure (Bot, ConfigManager, StateManager, GuildManager)
- [x] Service layer (LambdaService, DiscordService)
- [x] Basic interaction handlers (Button, Modal, SelectMenu)
- [x] Reusable UI components (Embeds, Buttons)
- [x] Utilities (Logger, ErrorHandler)
- [x] New entry point with graceful shutdown

### 🚧 In Progress

- [ ] Complete Discord service implementation (sync, refresh methods)
- [ ] Full button handler implementations
- [ ] Modal and select menu complete implementations
- [ ] Admin functionality migration
- [ ] Cron job implementations

### 📋 Next Steps

1. Implement remaining Discord service methods by migrating from old handlers
2. Complete button interaction implementations
3. Add comprehensive error handling
4. Test all functionality
5. Remove old handler files once migration is complete

## 🚀 Benefits

- **Maintainability**: Clear separation of concerns
- **Testability**: Each component can be tested independently
- **Scalability**: Easy to add new features
- **Reliability**: Better error handling and state management
- **Development**: Multiple developers can work on different components

## 🔧 Usage

The bot now starts with a clean entry point:

```bash
# Start the bot
npm start

# Development with auto-restart
npm run dev
```

All configuration is handled through environment variables as before, but now centralized in `ConfigManager`.
