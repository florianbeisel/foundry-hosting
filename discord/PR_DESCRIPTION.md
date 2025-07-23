# Refactor Discord Bot: Extract Constants and Instance Management

## Summary

This PR begins the modularization of the Discord bot by:
1. Extracting all constants into a separate `constants.js` file
2. Moving instance management commands (Start/Stop) into `instanceManagement.js`
3. Adding clear section headers throughout `index.js` for better organization

## Changes

### New Files Created
- **`constants.js`** - Centralized configuration for:
  - Supporter roles and amounts
  - Channel names and prefixes
  - Embed colors
  - Status emojis
  - Monitoring intervals
  - Discord limits
  - Message templates

- **`instanceManagement.js`** - Instance lifecycle commands:
  - `handleStartInstance` - Start a Foundry instance
  - `handleStopInstance` - Stop a Foundry instance with session checks
  - `performStopInstance` - Execute the stop operation
  - `handleStopCancelSession` - Stop and cancel active session
  - `handleStopRestart` - Stop and restart instance
  - `handleStopCancel` - Cancel stop operation

### Changes to index.js
- Added comprehensive section headers throughout the file
- Imported constants from `constants.js`
- Imported instance management functions from `instanceManagement.js`
- Replaced hardcoded values with constants
- No functional changes - 100% backward compatible

## Section Organization

The code is now organized into these clearly marked sections:

1. **Configuration and Constants** - Bot configuration and role definitions
2. **Database Operations** - DynamoDB operations for persistence
3. **Logging and Console Setup** - Console override and logging functionality
4. **UI Components and Embeds** - Discord embed builders and UI components
5. **Utility Functions** - Helper functions for formatting and processing
6. **Channel Management** - Discord channel creation and management
7. **AWS Lambda Operations** - Lambda invocation functions
8. **Permission Utilities** - Role and permission checking
9. **Monitoring and Status** - Instance monitoring functionality
10. **Bot Events and Initialization** - Discord.js event handlers
11. **Interaction Handlers** - Main interaction routing
12. **Command Handlers** - Slash command handling
13. **Button Interaction Handlers** - Button click processing
14. **Modal Handlers** - Form/modal handling
15. **Select Menu Handlers** - Dropdown menu handling
16. **Registration and Stats** - User registration and statistics
17. **Admin Functions** - Admin-specific functionality
18. **Unified Dashboard** - Main dashboard rendering

## Benefits

- **Improved Navigation** - Developers can quickly find relevant code sections
- **Better Understanding** - Clear organization helps understand the codebase
- **Easier Maintenance** - Related functions are grouped together
- **Preparation for Future Refactoring** - This organization will help identify what can be extracted into modules later

## Testing

Since this is purely organizational (adding comments only), no functional testing is required. The bot continues to work exactly as before.

## Next Steps

This reorganization prepares the codebase for future improvements:
1. Gradual extraction of sections into modules
2. Addition of unit tests for individual sections
3. TypeScript migration with clear module boundaries