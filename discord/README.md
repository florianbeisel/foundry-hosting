# Foundry VTT Discord Bot

Discord bot for managing Foundry VTT instances via Lambda API integration.

## 🏗️ Architecture

The Discord bot provides the user interface for the Foundry VTT hosting platform:

- **Slash Commands** - Modern Discord interface for instance management
- **Button Interactions** - Interactive controls for start/stop/status
- **Real-time Monitoring** - Live status updates during instance operations
- **Channel Management** - Dedicated command channels per user
- **Lambda Integration** - Serverless API calls for instance operations

## 📁 Structure

```
discord/
├── index.js              # Main bot application
├── commands/
│   ├── foundry.js        # Foundry instance management commands
│   └── admin.js          # Administrative functions
├── deploy-commands.js    # Discord slash command deployment
├── deploy.sh             # Docker deployment script
├── Dockerfile            # Container configuration
├── package.json
└── README.md
```

## 🚀 Setup

### 1. Discord Application Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create new application named "Foundry VTT Manager"
3. Add bot to application and copy bot token
4. Copy Application ID from General Information
5. Configure OAuth2 URL Generator:
   - **Scopes**: `bot`, `applications.commands`
   - **Permissions**:
     - `Send Messages`
     - `Use Slash Commands`
     - `Send Messages in Threads`
     - `Manage Channels` ⚠️ **REQUIRED**
     - `View Channels`
     - `Read Message History`

### 2. Environment Configuration

The bot receives configuration from AWS Secrets Manager (configured via Pulumi):

```bash
# Required
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
LAMBDA_FUNCTION_NAME=foundry-vtt-instance-management
AWS_REGION=us-east-1

# Optional
DISCORD_GUILD_ID=your-server-id
FOUNDRY_CATEGORY_ID=category-id-for-channels
ALLOWED_ROLES=role1,role2
ADMIN_ROLES=Admin,Moderator
KOFI_URL=https://ko-fi.com/yourusername
```

### 3. Deploy Commands

```bash
# Deploy slash commands to Discord
yarn deploy-commands
```

### 4. Deploy Bot

```bash
# Deploy to ECS via Docker
yarn deploy
```

## 📊 Commands

### User Commands

- **`/foundry user dashboard`** - Show instance dashboard with controls
- **`/foundry user help`** - Display help information

### Admin Commands

- **`/foundry admin overview`** - View system status and monitoring details
- **`/foundry admin setup-registration`** - Create permanent registration message
- **`/foundry admin recreate-registration`** - Recreate registration message if lost
- **`/foundry admin cleanup-mappings`** - Clean up old message mappings from DynamoDB

### Dashboard Features

- **Registration** - Create new Foundry instance
- **Start/Stop** - Control instance lifecycle
- **Status** - Real-time status monitoring
- **Admin Key** - Retrieve Foundry admin credentials
- **Destroy** - Permanently delete instance and resources

## 🔄 Bot Restart Synchronization

When the Discord bot restarts, it automatically:

1. **Discovers Instances** - Queries Lambda for all registered instances
2. **Finds Command Channels** - Locates existing user command channels
3. **Clears Channels** - Removes all messages for clean state
4. **Sends Welcome Message** - Notifies users of bot restart
5. **Posts Current Status** - Displays up-to-date instance status
6. **Restores Monitoring** - Re-establishes real-time status monitoring
7. **Validates Message Mappings** - Checks registration and admin status messages
8. **Cleans Invalid Mappings** - Removes broken message references automatically

### Channel Detection Strategies

The bot uses multiple strategies to find existing command channels:

1. **Exact Name Match** - `foundry-{username}-{last4UserId}`
2. **Topic Search** - Finds channels with user ID in topic
3. **Pattern Matching** - Finds channels with `foundry-*-{last4UserId}` pattern

This ensures channels are found even if Discord usernames have changed.

## 🏠 Permanent Registration

### Setup

Administrators can create permanent registration channels:

```bash
/foundry admin setup-registration [channel:#registration]
```

### Features

- **Universal Access** - Any user can register from the same message
- **Professional Embed** - Rich embed with feature highlights
- **Registration Button** - One-click registration process
- **Always Visible** - Permanent message stays at channel top

### Message Content

The registration message includes:

- **What You Get** - Private server, custom URL, admin access
- **Security & Privacy** - Isolated instances, encrypted storage
- **Cost Information** - Pay-per-use pricing model
- **Data Persistence** - Permanent world and asset storage
- **Easy Management** - Discord-based controls

## 🔐 Security Features

### Credential Management

- **DM Collection** - Sensitive credentials collected via private messages
- **Secrets Manager** - Credentials stored encrypted in AWS Secrets Manager
- **Admin Key Persistence** - Reuses admin keys across instance recreations

### Channel Isolation

- **Private Channels** - Each user gets exclusive command channel
- **Automatic Access** - Users automatically added to their channels
- **Admin Access** - Administrators can access all channels

## 📈 Monitoring & Status

### Real-time Updates

- **Startup Progress** - Live status updates during instance startup
- **Health Checks** - Continuous monitoring of instance health
- **Error Reporting** - Detailed error messages for troubleshooting

### Status Display

```text
🟢 Instance Status: Running
🌐 URL: https://username.domain.com
💰 This Month's Usage: 12.5h = $1.25
💸 Uncovered Cost: $0.75
☕ Donations Received: $0.50
```

## 🐳 Docker Deployment

### Build Process

```bash
# Build Docker image
yarn docker:build

# Tag for ECR
yarn docker:tag

# Login to ECR
yarn docker:login

# Push to ECR
yarn docker:push
```

### ECS Integration

The bot runs as an ECS Fargate service with:

- **ARM64 Architecture** - Uses Graviton processors for cost efficiency
- **256 CPU / 512 MB Memory** - Minimum Fargate configuration
- **Private Subnet** - Runs in private subnets for security
- **IAM Role** - Permissions to invoke Lambda functions

## 🔧 Development

### Local Development

```bash
# Install dependencies
yarn install

# Start development server
yarn dev
```

### Environment Variables

For local development, create `.env` file:

```bash
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-client-id
LAMBDA_FUNCTION_NAME=foundry-vtt-instance-management
AWS_REGION=us-east-1
```

### Testing Commands

```bash
# Test slash commands
yarn deploy-commands

# Test bot functionality
yarn dev
```

## 📝 Error Handling

The bot implements comprehensive error handling:

- **Graceful Degradation** - Partial failures don't break entire operations
- **User Feedback** - Clear error messages for users
- **Retry Logic** - Automatic retries for transient failures
- **Logging** - Detailed logging for debugging
- **Message Mapping Cleanup** - Automatic cleanup of invalid message references
- **Periodic Validation** - Scheduled cleanup every 6 hours to prevent mapping issues

## 🔗 Dependencies

- **discord.js** - Discord API client
- **@aws-sdk/client-lambda** - AWS Lambda client
- **@aws-sdk/client-dynamodb** - DynamoDB client
- **@aws-sdk/lib-dynamodb** - DynamoDB document client
- **node-cron** - Scheduled task management
- **dotenv** - Environment variable management

## 🔧 Troubleshooting

### Lost Registration or Admin Status Messages

If the bot loses track of registration or admin status messages after a restart:

1. **Automatic Cleanup** - The bot automatically detects and cleans invalid mappings on restart
2. **Manual Recreation** - Use `/foundry admin recreate-registration` to recreate lost registration messages
3. **Admin Status** - Use `/foundry admin overview` to recreate lost admin status messages
4. **Cleanup Command** - Use `/foundry admin cleanup-mappings` to clean up old DynamoDB entries
5. **Diagnostic Script** - Run `node cleanup-mappings.js` to check mapping status

### Common Issues

- **Messages Not Updating** - Check bot permissions in the channel
- **Mapping Errors** - Invalid mappings are automatically cleaned up every 6 hours
- **Restart Issues** - Bot validates all mappings on startup and logs any issues
