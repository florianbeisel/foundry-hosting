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
- **`/foundry user license-sharing`** - Manage your license sharing status

### Channel Lifecycle Management

The bot intelligently manages command channels based on user state:

**Channel Created When:**

- User registers their first instance
- User creates a new instance after destroying previous one

**Channel Preserved When:**

- User destroys instance but keeps license sharing active
- User needs to manage license sharing or create new instances

**Channel Deleted When:**

- User destroys instance and stops license sharing
- User stops license sharing without an active instance
- User has no instance and no active license sharing

**Channel Features When Preserved:**

- Clear explanation of why channel remains active
- Buttons to create new instance or manage license sharing
- Access to all `/foundry user` commands
- Automatic cleanup when license sharing is stopped

### Admin Commands

- **`/foundry admin overview`** - View system status and monitoring details
- **`/foundry admin setup-registration`** - Create permanent registration message
- **`/foundry admin recreate-registration`** - Recreate registration message if lost
- **`/foundry admin cleanup-mappings`** - Clean up old message mappings from DynamoDB
- **`/foundry admin test-log`** - Send a test log message to the logging channel

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

### Supporter System

The bot automatically applies supporter discounts based on Discord roles:

- **$15 Supporter** (Role ID: 699727231794020353) - $15 monthly credit
- **$10 Supporter** (Role ID: 699727011979067484) - $10 monthly credit
- **$5 Supporter** (Role ID: 699727432424620033) - $5 monthly credit

**How it works:**

- Supporter credits are automatically applied to monthly costs
- Credits reduce the "uncovered cost" amount
- Users see their supporter status in cost displays
- Ko-fi donation buttons show remaining costs after supporter credits

**Example Display:**

```
💰 This Month's Usage: 12.5h = $12.50
🎖️ Supporter Discount: $15.00 monthly credit
✅ Fully Covered
```

### License & Instance Terminology

The bot uses clear terminology to distinguish between licenses and instances:

- **Licenses** - Foundry VTT licenses that can be pooled with the community
- **Instances** - Individual Foundry VTT servers that can be shared
- **License Pooling** - When users contribute their licenses to the community pool
- **Shared Instances** - Instances that use community-pooled licenses (schedule-based access)
- **BYOL Instances** - Instances using the user's own license (on-demand access)

### Enhanced License State Management

The system now supports a comprehensive license state model that handles all user scenarios:

#### **License States:**

1. **🟢 Active** - License is currently shared and available for community use
2. **⏰ Scheduled Stop** - License sharing will stop after current sessions end
3. **🔴 Inactive** - License is private and not shared with the community
4. **👻 Orphaned** - License pool exists but user has no active instance

#### **State Transitions:**

**Initial Registration:**

- User registers → Instance created with `licenseType: "byol"`
- License sharing state: `inactive` (default)
- User can optionally enable sharing → State becomes `active`

**During Instance Lifecycle:**

- User enables sharing → `inactive` → `active`
- User disables sharing → `active` → `inactive`
- User schedules stop → `active` → `scheduled_stop`
- User cancels scheduled stop → `scheduled_stop` → `active`

**Instance Destruction:**

- User destroys + keeps sharing → Instance deleted, license state remains `active`
- User destroys + stops sharing → Instance deleted, license state becomes `inactive`
- User destroys + scheduled stop → Instance deleted, license state becomes `scheduled_stop`

**Recreation Scenarios:**

- User recreates instance with existing `active` license → License state remains `active`
- User recreates instance with `scheduled_stop` license → License state remains `scheduled_stop`
- User recreates instance with `inactive` license → License state remains `inactive`

**Edge Cases:**

- User has no instance but `active` license → State becomes `orphaned`
- System cleanup detects orphaned licenses → State becomes `inactive`
- User reactivates orphaned license → State becomes `active`

#### **State Fields:**

```typescript
interface FoundryInstance {
  // Core license fields
  licenseType?: "byol" | "pooled";
  allowLicenseSharing?: boolean;
  maxConcurrentUsers?: number;

  // Enhanced state management
  stopSharingAfterSessions?: boolean;
  licenseSharingScheduledStop?: number;
  licenseSharingState?: "active" | "scheduled_stop" | "inactive" | "orphaned";
  lastLicenseSharingChange?: number;
}
```

#### **User Scenarios Handled:**

1. **✅ Initial Registration** - User gets instance, may or may not share license
2. **✅ Dynamic Sharing Control** - User can enable/disable sharing anytime
3. **✅ Delayed Deactivation** - User can schedule sharing to stop after sessions
4. **✅ Instance Destruction with Sharing** - User destroys instance but keeps license shared
5. **✅ License Management Without Instance** - User can manage sharing even without active instance
6. **✅ Instance Recreation** - User can recreate instance with existing license state
7. **✅ Complete Data Cleanup** - User can destroy everything including license sharing

#### **Lambda Actions:**

- `manage-license-state` - Handles all license state transitions
  - `schedule_stop_after_sessions` - Schedule sharing to stop after current sessions
  - `cancel_scheduled_stop` - Cancel a scheduled stop
  - `immediate_stop` - Stop sharing immediately
  - `reactivate_sharing` - Reactivate sharing for existing license
  - `cleanup_orphaned` - Clean up orphaned license states

#### **Benefits:**

- **Consistent State** - All license states are properly tracked and managed
- **User Control** - Users have full control over their license sharing lifecycle
- **Community Fairness** - Active sessions are respected when stopping sharing
- **Data Integrity** - No orphaned or inconsistent license states
- **Flexible Workflows** - Supports all user scenarios and edge cases

### Logging Channel

The bot automatically creates a `#foundry-bot-logs` channel on startup that captures all console output:

- **Automatic Creation** - Channel is created in the first guild the bot joins
- **Console Override** - All `console.log`, `console.error`, and `console.warn` messages are captured
- **Smart Filtering** - Spam messages (heartbeats, rate limits, etc.) are automatically filtered
- **Grouped Messages** - Similar log messages are grouped together to reduce spam
- **Level-based Colors** - INFO (blue), WARN (yellow), ERROR (red) with appropriate emojis
- **Rate Limiting** - Messages are queued and sent with delays to avoid Discord rate limits

### Real-time Updates

- **Startup Progress** - Live status updates during instance startup
- **Health Checks** - Continuous monitoring of instance health
- **Error Reporting** - Detailed error messages for troubleshooting

### Community Statistics Display

The bot provides a comprehensive statistics embed with organized information:

**Instance Status Row:**

- Total instances, currently running, BYOL instances, shared instances

**License Pool Status Row:**

- Active license pools, total shared licenses, availability for scheduling
- Community members sharing their licenses

**Cost Coverage Row (Highlighted):**

- Monthly cost with color-coded coverage percentage (🟢 100%+, 🟡 75%+, 🔴 <75%)
- Donations received, supporter credits, remaining uncovered amount

**License Pool Details:**

- List of active license pools with owner names and concurrent user limits

**Example Display:**

```
📊 Foundry VTT Community Statistics
Real-time overview of our community's Foundry VTT usage

🚀 Instance Status          🔗 License Pool Status
Total Instances: 5         Active License Pools: 3
Currently Running: 2       Total Shared Licenses: 8
BYOL Instances: 3          Available for Scheduling: ✅ Yes
Shared Instances: 2        Community Members Sharing: 3

🟢 Cost Coverage (95%)
Monthly Cost: $45.20
Donations Received: $25.00
Supporter Credits: $18.00 (3 users)
Remaining Uncovered: $2.20

🤝 Active License Pools
username1 - 3 concurrent users
username2 - 3 concurrent users
username3 - 2 concurrent users
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
