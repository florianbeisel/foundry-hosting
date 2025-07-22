# Lambda Instance Management API

Serverless functions for managing Foundry VTT instances on AWS ECS Fargate.

## 🏗️ Architecture

The Lambda API handles all instance lifecycle operations:

- **Instance Creation** - ECS task definition registration and startup
- **Instance Management** - Start, stop, status monitoring
- **Resource Management** - EFS access points, S3 buckets, IAM users
- **Scheduling** - Auto-shutdown and session preparation
- **Cost Tracking** - Usage monitoring and Ko-fi integration

## 📁 Structure

```
lambda/
├── src/
│   ├── index.ts              # Main Lambda handler
│   └── utils/
│       ├── alb-manager.ts     # Application Load Balancer management
│       ├── auto-shutdown-manager.ts # Idle instance shutdown
│       ├── dynamodb-manager.ts # Database operations
│       ├── ecs-manager.ts     # ECS task management
│       ├── efs-manager.ts     # EFS access point management
│       ├── iam-manager.ts     # IAM user and policy management
│       ├── license-scheduler.ts # License pool and scheduling
│       ├── route53-manager.ts # DNS record management
│       ├── s3-manager.ts      # S3 bucket management
│       ├── secrets-manager.ts # Credential storage
│       ├── task-manager.ts    # Task definition utilities
│       └── usage-manager.ts   # Cost and usage tracking
├── package.json
└── tsconfig.json
```

## 🔧 Core Functions

### Instance Lifecycle Management

- **`create-instance`** - Creates new Foundry VTT instance
- **`start-instance`** - Starts existing instance
- **`stop-instance`** - Stops running instance
- **`destroy-instance`** - Permanently deletes instance and resources
- **`status`** - Returns current instance status

### Resource Management

- **EFS Access Points** - Per-user isolated storage
- **S3 Buckets** - Static asset storage with IAM isolation
- **IAM Users** - Dedicated credentials for S3 access
- **DNS Records** - Custom subdomain routing
- **ALB Rules** - Load balancer target group management

### Scheduling & Automation

- **`auto-shutdown-check`** - EventBridge-triggered idle detection
- **`prepare-sessions`** - Pre-scheduled session startup
- **License Pooling** - Shared license management
- **Usage Tracking** - Monthly cost and usage monitoring

## 🚀 Deployment

### Build

```bash
cd lambda
yarn install
yarn build
```

### Environment Variables

The Lambda function requires these environment variables (set by Pulumi):

```bash
# ECS Configuration
CLUSTER_NAME=foundry-vtt-cluster
TASK_SECURITY_GROUP_ID=sg-xxx
TASK_ROLE_ARN=arn:aws:iam::xxx:role/xxx
EXECUTION_ROLE_ARN=arn:aws:iam::xxx:role/xxx
PRIVATE_SUBNET_IDS=subnet-xxx,subnet-yyy

# Storage Configuration
FILE_SYSTEM_ID=fs-xxx
INSTANCE_TABLE_NAME=foundry-vtt-instances
SCHEDULE_TABLE_NAME=foundry-vtt-schedules
LICENSE_POOL_TABLE_NAME=foundry-vtt-instances-license-pool
SCHEDULED_SESSIONS_TABLE_NAME=foundry-vtt-instances-scheduled-sessions
LICENSE_RESERVATIONS_TABLE_NAME=foundry-vtt-instances-license-reservations
USAGE_TABLE_NAME=foundry-vtt-usage
BOT_CONFIG_TABLE_NAME=foundry-vtt-bot-config

# Networking Configuration
LOAD_BALANCER_ARN=arn:aws:elasticloadbalancing:xxx
ALB_DNS_NAME=xxx.region.elb.amazonaws.com
ALB_HTTPS_LISTENER_ARN=arn:aws:elasticloadbalancing:xxx
ROUTE53_HOSTED_ZONE_ID=Z123456789
DOMAIN_NAME=your-domain.com

# Ko-fi Integration (Optional)
KOFI_VERIFICATION_TOKEN=xxx
KOFI_URL=https://ko-fi.com/xxx
```

## 📊 API Endpoints

### Instance Management

```typescript
// Create new instance
POST /
  {
    action: "create-instance",
    userId: string,
    username: string,
    foundryLicense: string,
    foundryAdminKey: string,
    foundryVersion: string,
  };

// Start instance
POST /
  {
    action: "start-instance",
    userId: string,
  };

// Stop instance
POST /
  {
    action: "stop-instance",
    userId: string,
  };

// Get instance status
POST /
  {
    action: "status",
    userId: string,
  };

// Destroy instance
POST /
  {
    action: "destroy-instance",
    userId: string,
  };
```

### Scheduling

```typescript
// Schedule session
POST /
  {
    action: "schedule-session",
    userId: string,
    startTime: number,
    duration: number,
  };

// Cancel scheduled session
POST /
  {
    action: "cancel-scheduled-session",
    userId: string,
    sessionId: string,
  };
```

### Admin Functions

```typescript
// Admin overview
POST /
  {
    action: "admin-overview",
    userId: string,
  };

// Ko-fi webhook
POST /
  {
    action: "kofi-webhook",
    body: KoFiWebhookPayload,
  };
```

## 🔐 Security Model

### IAM Permissions

The Lambda function requires extensive IAM permissions for:

- **ECS Management** - Task definition, running, stopping
- **EFS Management** - Access point creation/deletion
- **S3 Management** - Bucket creation, policy configuration
- **IAM Management** - User creation, access keys, policies
- **Route53 Management** - DNS record creation/deletion
- **ALB Management** - Target group and rule management
- **DynamoDB Access** - All table operations
- **Secrets Manager** - Credential storage/retrieval

### Resource Isolation

- **Per-user EFS Access Points** - Isolated storage paths
- **Per-user S3 Buckets** - Dedicated static asset storage
- **Per-user IAM Users** - Bucket-specific credentials
- **Per-user DNS Records** - Custom subdomains

## 📈 Monitoring

### CloudWatch Logs

- **Log Group**: `/aws/lambda/foundry-vtt-instance-management`
- **Retention**: 3 days
- **Structured Logging**: JSON format with request IDs

### Metrics

- **Instance Operations** - Create, start, stop, destroy
- **Resource Usage** - EFS, S3, ECS task counts
- **Error Rates** - Failed operations and exceptions
- **Performance** - Lambda duration and memory usage

## 🔄 EventBridge Integration

### Auto-shutdown Rule

- **Schedule**: Every 5 minutes
- **Action**: `auto-shutdown-check`
- **Purpose**: Detect and stop idle instances

### Session Preparation Rule

- **Schedule**: Every minute
- **Action**: `prepare-sessions`
- **Purpose**: Start instances for upcoming scheduled sessions

## 🛠️ Development

### Local Testing

```bash
# Install dependencies
yarn install

# Build TypeScript
yarn build

# Test with sample event
aws lambda invoke \
  --function-name foundry-vtt-instance-management \
  --payload '{"action":"status","userId":"123456789"}' \
  response.json
```

### Debugging

Enable detailed logging by setting log level:

```typescript
console.log(
  "DEBUG:",
  JSON.stringify({
    action: event.action,
    userId: event.userId,
    timestamp: new Date().toISOString(),
  })
);
```

## 📝 Error Handling

The Lambda function implements comprehensive error handling:

- **Graceful Degradation** - Partial failures don't break entire operations
- **Retry Logic** - Automatic retries for transient AWS API errors
- **Resource Cleanup** - Automatic cleanup on partial failures
- **User Feedback** - Detailed error messages for debugging

## 🔗 Dependencies

- **@aws-sdk/client-ecs** - ECS task management
- **@aws-sdk/client-efs** - EFS access point management
- **@aws-sdk/client-s3** - S3 bucket operations
- **@aws-sdk/client-iam** - IAM user management
- **@aws-sdk/client-dynamodb** - Database operations
- **@aws-sdk/client-route-53** - DNS management
- **@aws-sdk/client-secrets-manager** - Credential storage
- **uuid** - Unique identifier generation
