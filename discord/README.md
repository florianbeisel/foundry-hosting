# Foundry VTT Discord Bot Setup

## 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name it "Foundry VTT Manager"
4. Go to "Bot" tab and click "Add Bot"
5. Copy the bot token
6. Go to "General Information" and copy Application ID
7. Go to "OAuth2" → "URL Generator"
   - Scopes: `bot`, `applications.commands`
   - Permissions:
     - `Send Messages`
     - `Use Slash Commands`
     - `Send Messages in Threads`
     - `Manage Channels` ⚠️ **REQUIRED** - Bot needs this to create user command channels
     - `View Channels`
     - `Read Message History`
   - Copy the generated URL to invite the bot

⚠️ **Important**: The bot MUST have "Manage Channels" permission to create individual user command channels. Without this permission, user registration will fail.

## 2. Setup Environment

```bash
# Create the bot directory
mkdir discord-bot
cd discord-bot

# Install dependencies
yarn install

# Configure environment
cp .env.example .env
# Edit .env with your values
```

## 3. Deploy Commands

```bash
# Deploy slash commands to your Discord server
npm run deploy-commands
```

## 4. Start the Bot

```bash
# For development (auto-restart on changes)
npm run dev

# For production
npm start
```

## 5. Test the Bot

In your Discord server:

1. Type `/foundry help` to see available commands
2. Try `/foundry create` to create your first instance
3. Check that DMs work for credential collection

## Docker Deployment to ECR

The Discord bot is designed to run in AWS ECS using Docker images stored in ECR.

### Quick Deployment

```bash
# Deploy with the automated script
./deploy.sh

# Or use npm script
npm run deploy
```

### Manual Deployment

```bash
# Build and push manually
npm run docker:build
npm run docker:tag
npm run docker:login
npm run docker:push

# Update ECS service to use new image
aws ecs update-service --cluster foundry-vtt-cluster --service foundry-vtt-discord-bot --force-new-deployment
```

### Prerequisites

- Docker installed and running
- AWS CLI configured with appropriate permissions
- `jq` installed for JSON parsing
- Pulumi stack deployed with ECR repository

## Environment Variables

The bot gets its configuration from AWS Secrets Manager (configured via Pulumi):

- `DISCORD_TOKEN` - Your bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID` - Your application ID
- `DISCORD_GUILD_ID` - Your Discord server ID (for faster command deployment)
- `LAMBDA_FUNCTION_NAME` - Name of your Lambda function
- `AWS_REGION` - AWS region (default: us-east-1)
- `FOUNDRY_CATEGORY_ID` - Category ID for organizing user command channels (optional)
- `ALLOWED_ROLES` - Comma-separated list of roles that can use the bot (optional)
- `ADMIN_ROLES` - Comma-separated list of admin roles (optional)

## Features

✅ **Slash Commands** - Modern Discord interface  
✅ **Secure Credential Collection** - DMs for sensitive info  
✅ **Rich Embeds** - Beautiful, informative responses  
✅ **Error Handling** - Graceful error messages  
✅ **Role-based Permissions** - Control who can use the bot  
✅ **Admin Commands** - Administrative functions  
✅ **Real-time Status** - Live instance status updates  
✅ **Docker Containerized** - Runs in AWS ECS  
✅ **ECR Integration** - Automatic image publishing  
✅ **Auto Channel Access** - Users automatically added to command channels when created  
✅ **Startup Sync** - Running instances restored to command channels on bot restart  
✅ **Channel Management** - Complete message clearing and status synchronization  
✅ **Permanent Registration** - Admin-posted registration messages for easy user onboarding

## Commands

- `/foundry dashboard` - Show your Foundry dashboard with controls
- `/foundry help` - Show help information
- `/foundry setup-registration` - Post permanent registration message (Admin only)

### Dashboard Features

- **Registration** - Create new Foundry instance
- **Start/Stop** - Control your instance
- **Status** - Real-time status monitoring
- **Admin Key** - Retrieve your admin credentials securely
- **Destroy** - Permanently delete instance

## Smart Channel Management

### Automatic User Access

When a command channel is created for a user, they are automatically:

- Added to the channel with proper permissions (ViewChannel, SendMessages, ReadMessageHistory)
- Given exclusive access (channel is private to them and admins)
- Placed in the configured category if FOUNDRY_CATEGORY_ID is set

### Bot Restart Synchronization

When the Discord bot restarts:

1. **Discovers all instances** - Queries Lambda for all registered instances
2. **Finds command channels** - Locates existing user command channels using multiple detection strategies
3. **Completely clears channels** - Removes ALL messages for a clean, fresh view
4. **Sends welcome message** - Notifies users that bot has restarted and synced their instance
5. **Posts current status** - Displays up-to-date instance status and controls
6. **Restores monitoring** - Re-establishes real-time status monitoring for running instances

This ensures users always see accurate information even after bot downtime or maintenance.

### Robust Channel Detection

The bot uses multiple strategies to find existing command channels:

1. **Exact name match** - `foundry-{username}-{last4UserId}` (current Discord username)
2. **Topic search** - Finds channels with user ID in the topic
3. **Pattern matching** - Finds channels with `foundry-*-{last4UserId}` pattern (handles username changes)

This ensures channels are found even if:

- Discord usernames have changed since channel creation
- Channels were created with old usernames
- Bot cache needs to be refreshed

All existing channels will be properly detected and synchronized on bot restart.

## Permanent Registration Channel

### Setup

Administrators can create a permanent registration channel where users can sign up without needing to use slash commands:

```bash
/foundry setup-registration [channel:#registration]
```

This posts a persistent registration message with:

- Complete feature overview
- Registration button that works for any user
- Professional embed with all hosting details

### Benefits

- **No slash commands required** - Users just click a button
- **Always visible** - Permanent message stays at the top of the channel
- **Professional appearance** - Rich embed with feature highlights
- **Universal access** - Any user can register from the same message

### Message Content

The registration message includes:

- **What You Get** - Private server, custom URL, admin access
- **Security & Privacy** - Isolated instances, encrypted storage
- **Cost Information** - Pay-per-use pricing model
- **Data Persistence** - Permanent world and asset storage
- **Easy Management** - Discord-based controls

Users click the "🎮 Register New Instance" button to start the registration process, which works exactly like the dashboard registration flow.
