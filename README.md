# Foundry VTT AWS Hosting Platform

A serverless AWS-based hosting solution for Foundry Virtual Tabletop with Discord bot integration for instance management.

## 🏗️ Architecture

The platform consists of three main components:

- **Infrastructure** (`index.ts`) - Pulumi-managed AWS resources
- **Lambda API** (`lambda/`) - Serverless instance management functions
- **Discord Bot** (`discord/`) - User interface for instance control

### Core Infrastructure Components

- **ECS Fargate** - Serverless container hosting for Foundry VTT instances
- **EFS Storage** - Persistent file storage with per-user access points
- **Application Load Balancer** - HTTPS termination and routing
- **Route53 DNS** - Custom subdomain routing (`username.domain.com`)
- **DynamoDB** - Instance state, scheduling, and usage tracking
- **Secrets Manager** - Encrypted credential storage
- **S3 Buckets** - Per-instance static asset storage with IAM isolation
- **EventBridge** - Automated shutdown and session scheduling

### Data Flow

```text
Discord Bot → Lambda API → AWS Services
     ↓              ↓           ↓
  User Commands  Instance   ECS/EFS/S3
     ↓              ↓           ↓
  Status Updates  State Mgmt  Resource Control
```

## 🔧 Technical Stack

- **Infrastructure**: Pulumi (TypeScript)
- **Compute**: ECS Fargate (ARM64 Graviton)
- **Storage**: EFS (persistent) + S3 (static assets)
- **Database**: DynamoDB (serverless)
- **Security**: Secrets Manager + IAM
- **Networking**: ALB + Route53 + VPC
- **Discord**: Discord.js v14
- **Runtime**: Node.js 18

## 🚀 Deployment

### Prerequisites

- AWS Account with appropriate permissions
- Discord Application and Bot Token
- Domain name hosted in Route53
- Foundry VTT license

### Configuration

```bash
# Configure Pulumi
pulumi config set foundry-hosting:domainName your-domain.com
pulumi config set foundry-hosting:route53HostedZoneId Z123456789
pulumi config set discord:token --secret your-bot-token
pulumi config set discord:clientId your-client-id

# Optional: Ko-fi integration
pulumi config set kofiUrl "https://ko-fi.com/yourusername"
pulumi config set kofiVerificationToken --secret "your-kofi-webhook-token"
```

### Deploy Infrastructure

```bash
pulumi up
```

### Deploy Discord Bot

```bash
cd discord
yarn deploy
```

## 📊 Features

### Instance Management

- **Per-User Isolation** - Each user gets dedicated EFS access point and S3 bucket
- **Username-based URLs** - Custom subdomains (`username.domain.com`)
- **Admin Key Persistence** - Reuses admin keys across instance recreations
- **Auto-shutdown** - Configurable idle timeout via EventBridge
- **Session Scheduling** - Pre-scheduled instance startup

### S3 Static Asset Integration

- **Per-instance S3 buckets** - Dedicated storage for each user's static assets
- **Direct S3 serving** - Images, audio, and assets served directly from S3
- **Automatic configuration** - `FOUNDRY_AWS_CONFIG` generated per instance
- **IAM user isolation** - Each instance gets dedicated IAM credentials
- **CORS configuration** - Properly configured for Foundry VTT access patterns

### Cost Tracking & Ko-fi Integration

- **Usage Tracking** - Per-user monthly hour and cost tracking
- **Voluntary Donations** - Optional Ko-fi integration for cost coverage
- **Real-time Cost Display** - Live cost information in Discord status messages
- **Donation Buttons** - One-click Ko-fi donation links with pre-filled user ID
- **Coverage Analytics** - Admin dashboard shows donation coverage statistics
- **Monthly Reset** - Clean slate each month for usage and donations

### Discord Bot Features

- **Slash Commands** - Modern Discord interface for instance management
- **Button Interactions** - Easy start/stop/status controls
- **Real-time Monitoring** - Live status updates during startup
- **Admin Key Management** - Secure delivery of Foundry admin credentials
- **Channel Management** - Dedicated command channels per user
- **Bot Restart Sync** - Automatically syncs running instances on bot restart

## 📖 Usage

### For Users

1. **Registration**: Use `/foundry dashboard` or click permanent registration button
2. **Credentials**: Provide Foundry VTT credentials via DM
3. **Instance Created**: Get private command channel with controls
4. **Start Instance**: Click "Start Instance" button
5. **Access Foundry**: Use your custom URL (e.g., `https://username.domain.com`)
6. **S3 Assets**: Upload assets to Foundry - they'll automatically use S3 for better performance

### For Administrators

- **Setup Registration**: `/foundry setup-registration` to create permanent signup
- **Monitor Instances**: Bot provides real-time status updates
- **Manage Resources**: All AWS resources automatically managed

## 🔗 Related Documentation

- [Foundry VTT S3 Integration](https://foundryvtt.com/article/aws-s3/)
- [Foundry Docker Container](https://github.com/felddy/foundryvtt-docker)
- [AWS Pulumi Documentation](https://www.pulumi.com/docs/clouds/aws/)

## 📝 License

This project is provided as-is for educational and personal use.
