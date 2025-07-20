# Foundry VTT AWS Hosting Platform

A comprehensive AWS-based hosting solution for Foundry Virtual Tabletop with Discord bot integration.

## 🚀 Features

### Core Infrastructure

- **ECS Fargate** - Serverless container hosting with auto-scaling
- **EFS Storage** - Persistent file storage for worlds and assets
- **Application Load Balancer** - High availability with health checks
- **Route53 DNS** - Custom subdomain routing (`username.domain.com`)
- **DynamoDB** - Instance state and metadata storage
- **Secrets Manager** - Encrypted credential storage

### S3 Static Asset Integration ⭐ NEW

- **Per-instance S3 buckets** - Dedicated storage for each user's static assets
- **Direct S3 serving** - Images, audio, and assets served directly from S3 for better performance
- **Automatic configuration** - FOUNDRY_AWS_CONFIG automatically generated per instance
- **IAM user isolation** - Each instance gets dedicated IAM credentials with bucket-only access
- **CORS configuration** - Properly configured for Foundry VTT access patterns

### Discord Bot Management

- **Slash commands** - Modern Discord interface for instance management
- **Button interactions** - Easy start/stop/status controls
- **Real-time monitoring** - Live status updates during startup
- **Admin key management** - Secure delivery of Foundry admin credentials
- **Channel management** - Dedicated command channels per user

### Advanced Features

- **Username-based URLs** - User-friendly subdomains instead of IDs
- **Admin key persistence** - Reuses admin keys across instance recreations
- **Bot restart sync** - Automatically syncs running instances on bot restart
- **Complete cleanup** - Full resource cleanup on instance destruction
- **Permanent registration** - Admin-posted registration messages

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Discord Bot   │    │   Lambda API     │    │   ECS Fargate   │
│   (ECS Task)    ├────┤   (Instance Mgmt)├────┤  (Foundry VTT)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌────────────────┐              │
         └──────────────┤   DynamoDB     ├──────────────┘
                        │   (Instance    │
                        │    State)      │
                        └────────────────┘
                                 │
               ┌─────────────────┼─────────────────┐
               │                 │                 │
    ┌─────────────────┐ ┌────────────────┐ ┌─────────────────┐
    │      EFS        │ │ Secrets Manager │ │   S3 Buckets   │
    │  (Persistent    │ │  (Credentials)  │ │ (Static Assets) │
    │   Storage)      │ └────────────────┘ └─────────────────┘
    └─────────────────┘                            │
               │                                   │
    ┌─────────────────┐                   ┌─────────────────┐
    │      ALB        │                   │   IAM Users     │
    │  (Load Balance) │                   │ (S3 Access Keys)│
    └─────────────────┘                   └─────────────────┘
               │
    ┌─────────────────┐
    │    Route53      │
    │  (DNS Records)  │
    └─────────────────┘
```

## 📦 S3 Static Assets

### How It Works

Each Foundry VTT instance gets its own dedicated S3 bucket for serving static assets:

1. **Bucket Creation** - Unique bucket per user: `foundry-{username}-{userid}`
2. **IAM Isolation** - Dedicated IAM user with access only to their bucket
3. **Auto-Configuration** - `FOUNDRY_AWS_CONFIG` environment variable automatically set
4. **Public Read Access** - Bucket configured for public read access for asset serving
5. **CORS Setup** - Proper CORS configuration for browser access

### Performance Benefits

- **Faster Loading** - Static assets served directly from S3 CDN
- **Reduced Server Load** - Foundry server only handles dynamic content
- **Global Distribution** - S3's global infrastructure for better performance
- **Bandwidth Savings** - Assets don't consume Foundry container bandwidth

### Automatic Configuration

The Lambda function automatically configures each instance with:

```json
{
  "buckets": ["foundry-username-12345678"],
  "region": "us-east-1",
  "credentials": {
    "accessKeyId": "AKIA...",
    "secretAccessKey": "..."
  }
}
```

This is passed to the Foundry Docker container via `FOUNDRY_AWS_CONFIG` environment variable.

### Security Model

- **Bucket Isolation** - Each user can only access their own bucket
- **IAM Least Privilege** - Users can only perform necessary S3 operations
- **Automatic Cleanup** - Buckets and IAM users deleted with instance destruction
- **Public Assets Only** - Only static assets are in S3, worlds remain in EFS

## 🔧 Technical Stack

- **Infrastructure**: AWS Pulumi (TypeScript)
- **Compute**: ECS Fargate
- **Storage**: EFS (persistent) + S3 (static assets)
- **Database**: DynamoDB
- **Security**: Secrets Manager + IAM
- **Networking**: ALB + Route53
- **Discord**: Discord.js v14
- **Runtime**: Node.js 18

## 🚀 Getting Started

### Prerequisites

- AWS Account with appropriate permissions
- Discord Application and Bot Token
- Domain name hosted in Route53
- Foundry VTT license

### Deployment

1. **Configure Pulumi**:

   ```bash
   pulumi config set foundry-hosting:domainName your-domain.com
   pulumi config set foundry-hosting:route53HostedZoneId Z123456789
   pulumi config set discord:token --secret your-bot-token
   pulumi config set discord:clientId your-client-id
   ```

2. **Deploy Infrastructure**:

   ```bash
   pulumi up
   ```

3. **Deploy Discord Bot**:
   ```bash
   cd discord
   npm run deploy
   ```

### Required IAM Permissions

The Lambda function requires additional permissions for S3 and IAM management:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:PutBucketPolicy",
        "s3:PutBucketCors",
        "s3:PutBucketVersioning",
        "s3:ListBucket",
        "s3:DeleteObject",
        "iam:CreateUser",
        "iam:DeleteUser",
        "iam:CreateAccessKey",
        "iam:DeleteAccessKey",
        "iam:PutUserPolicy",
        "iam:DeleteUserPolicy",
        "iam:ListAccessKeys"
      ],
      "Resource": "*"
    }
  ]
}
```

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
