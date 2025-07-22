# Infrastructure Documentation

Pulumi-managed AWS infrastructure for Foundry VTT hosting platform.

## 🏗️ Architecture Overview

The infrastructure consists of three main layers:

1. **Networking** - VPC, subnets, security groups, and load balancer
2. **Compute & Storage** - ECS cluster, EFS file system, and S3 buckets
3. **Management** - Lambda functions, DynamoDB tables, and monitoring

## 🌐 Networking Layer

### VPC Configuration

```typescript
const vpc = new awsx.ec2.Vpc(`${projectName}-vpc`, {
  cidrBlock: "10.0.0.0/16",
  numberOfAvailabilityZones: 2,
  enableDnsHostnames: true,
  enableDnsSupport: true,
  natGateways: {
    strategy: NatGatewayStrategy.Single,
  },
});
```

**Features:**

- **Multi-AZ Setup** - 2 availability zones for high availability
- **Public/Private Subnets** - Public for ALB, private for ECS tasks
- **Single NAT Gateway** - Cost-optimized internet access for private subnets
- **DNS Support** - Full DNS resolution and hostname support

### Security Groups

#### EFS Security Group

- **Inbound**: NFS (port 2049) from VPC CIDR
- **Outbound**: All traffic to 0.0.0.0/0

#### ALB Security Group

- **Inbound**: HTTP (80) and HTTPS (443) from 0.0.0.0/0
- **Outbound**: All traffic to 0.0.0.0/0

#### ECS Task Security Group

- **Inbound**: Foundry VTT (port 30000) from ALB security group
- **Outbound**:
  - EFS (port 2049) to EFS security group
  - HTTPS (443) to 0.0.0.0/0
  - HTTP (80) to 0.0.0.0/0
  - DNS (53) to 0.0.0.0/0

### Load Balancer

```typescript
const loadBalancer = new aws.lb.LoadBalancer(`${projectName}-alb`, {
  internal: false,
  loadBalancerType: "application",
  securityGroups: [albSecurityGroup.id],
  subnets: vpc.publicSubnetIds,
  enableDeletionProtection: false,
});
```

**Features:**

- **Application Load Balancer** - Layer 7 load balancing
- **Public Access** - Internet-facing for user access
- **HTTPS Termination** - SSL certificate management
- **Health Checks** - Automatic instance health monitoring

### SSL Certificate

```typescript
const wildcardCertificate = new aws.acm.Certificate(
  `${projectName}-wildcard-cert`,
  {
    domainName: `*.${domainName}`,
    subjectAlternativeNames: [domainName],
    validationMethod: "DNS",
  }
);
```

**Features:**

- **Wildcard Certificate** - Covers all user subdomains
- **DNS Validation** - Automatic certificate validation
- **Base Domain Coverage** - Also covers the main domain

## 💾 Storage Layer

### EFS File System

```typescript
const fileSystem = new aws.efs.FileSystem(`${projectName}-efs`, {
  performanceMode: "generalPurpose",
  throughputMode: "bursting",
  encrypted: true,
  lifecyclePolicies: [
    {
      transitionToIa: "AFTER_30_DAYS",
    },
  ],
});
```

**Features:**

- **General Purpose Performance** - Balanced performance and cost
- **Bursting Throughput** - Automatic throughput scaling
- **Encryption at Rest** - AES-256 encryption
- **Lifecycle Policies** - Automatic transition to IA storage
- **Multi-AZ Mount Targets** - High availability across AZs

### Mount Targets

```typescript
const mountTargets = vpc.privateSubnetIds.apply((subnetIds) =>
  subnetIds.map(
    (subnetId, index) =>
      new aws.efs.MountTarget(`${projectName}-efs-mount-${index}`, {
        fileSystemId: fileSystem.id,
        subnetId: subnetId,
        securityGroups: [efsSecurityGroup.id],
      })
  )
);
```

**Features:**

- **Private Subnet Placement** - Secure network isolation
- **Security Group Association** - Controlled access
- **Multi-AZ Distribution** - One mount target per AZ

## 🖥️ Compute Layer

### ECS Cluster

```typescript
const cluster = new aws.ecs.Cluster(`${projectName}-cluster`, {
  name: `${projectName}-cluster`,
});
```

**Features:**

- **Fargate Support** - Serverless container execution
- **ARM64 Optimization** - Graviton processor support
- **Auto-scaling** - Automatic resource management

### IAM Roles

#### Execution Role

- **Purpose**: ECS task execution (pulling images, logging)
- **Policies**:
  - `AmazonECSTaskExecutionRolePolicy`
  - CloudWatch Logs access
  - Secrets Manager access

#### Task Role

- **Purpose**: Runtime permissions for Foundry VTT
- **Policies**:
  - EFS access point management
  - S3 bucket access (via IAM users)
  - Lambda invocation (for Discord bot)

## 📊 Data Layer

### DynamoDB Tables

#### Instance Table

```typescript
const instanceTable = new aws.dynamodb.Table(`${projectName}-instances`, {
  name: `${projectName}-instances`,
  billingMode: "PAY_PER_REQUEST",
  hashKey: "userId",
  attributes: [
    { name: "userId", type: "S" },
    { name: "taskArn", type: "S" },
  ],
  globalSecondaryIndexes: [
    {
      name: "TaskArnIndex",
      hashKey: "taskArn",
      projectionType: "ALL",
    },
  ],
});
```

**Features:**

- **Pay-per-request** - Cost-optimized billing
- **User-centric Design** - userId as primary key
- **Task Indexing** - Efficient task lookup
- **TTL Support** - Automatic record expiration

#### Additional Tables

- **License Pool** - Shared license management
- **Scheduled Sessions** - Session scheduling
- **License Reservations** - License reservation tracking
- **Usage Tracking** - Cost and usage monitoring
- **Bot Configuration** - Discord bot state

## 🔧 Management Layer

### Lambda Function

```typescript
const instanceManagementLambda = new aws.lambda.Function(
  `${projectName}-instance-lambda`,
  {
    name: `${projectName}-instance-management`,
    runtime: aws.lambda.Runtime.NodeJS18dX,
    code: new pulumi.asset.AssetArchive({
      ".": new pulumi.asset.FileArchive("./lambda"),
    }),
    handler: "dist/index.handler",
    role: lambdaRole.arn,
    timeout: 300,
  }
);
```

**Features:**

- **Node.js 18 Runtime** - Latest LTS version
- **5-minute Timeout** - Extended for complex operations
- **Asset Archive** - Automatic code packaging
- **IAM Role Integration** - Comprehensive permissions

### Lambda Permissions

The Lambda function requires extensive permissions for:

- **ECS Management** - Task definition, running, stopping
- **EFS Management** - Access point creation/deletion
- **S3 Management** - Bucket creation, policy configuration
- **IAM Management** - User creation, access keys, policies
- **Route53 Management** - DNS record creation/deletion
- **ALB Management** - Target group and rule management
- **DynamoDB Access** - All table operations
- **Secrets Manager** - Credential storage/retrieval

### EventBridge Rules

#### Auto-shutdown Rule

```typescript
const autoShutdownRule = new aws.cloudwatch.EventRule(
  `${projectName}-auto-shutdown-rule`,
  {
    description: "Trigger auto-shutdown check every 5 minutes",
    scheduleExpression: "rate(5 minutes)",
  }
);
```

#### Session Preparation Rule

```typescript
const sessionPrepRule = new aws.cloudwatch.EventRule(
  `${projectName}-session-prep-rule`,
  {
    description: "Prepare upcoming scheduled sessions every minute",
    scheduleExpression: "rate(1 minute)",
  }
);
```

## 🔐 Security Features

### Encryption

- **EFS Encryption** - AES-256 encryption at rest
- **Secrets Manager** - Encrypted credential storage
- **DynamoDB Encryption** - Server-side encryption enabled

### Network Security

- **Private Subnets** - ECS tasks in private subnets
- **Security Groups** - Granular access control
- **VPC Isolation** - Complete network isolation

### Access Control

- **IAM Roles** - Least privilege access
- **Per-user Isolation** - Dedicated resources per user
- **Secrets Management** - Secure credential handling

## 📈 Monitoring & Logging

### CloudWatch Logs

- **ECS Logs** - Container application logs
- **Lambda Logs** - Function execution logs
- **Discord Bot Logs** - Bot operation logs

### Log Retention

- **ECS Logs**: 3 days
- **Lambda Logs**: 3 days
- **Discord Bot Logs**: 1 day

## 💰 Cost Optimization

### Resource Selection

- **Fargate Spot** - Consider for non-critical workloads
- **ARM64 Architecture** - Graviton processors for cost efficiency
- **Pay-per-request DynamoDB** - No provisioned capacity
- **Single NAT Gateway** - Reduced networking costs

### Storage Optimization

- **EFS IA Transition** - Automatic cost reduction
- **S3 Lifecycle Policies** - Consider for long-term storage
- **Log Retention Limits** - Reduced storage costs

## 🚀 Deployment

### Prerequisites

```bash
# Configure Pulumi
pulumi config set foundry-hosting:domainName your-domain.com
pulumi config set foundry-hosting:route53HostedZoneId Z123456789
pulumi config set discord:token --secret your-bot-token
pulumi config set discord:clientId your-client-id
```

### Deploy Infrastructure

```bash
pulumi up
```

### Verify Deployment

```bash
pulumi stack output
```

## 🔄 Updates & Maintenance

### Infrastructure Updates

```bash
# Update infrastructure
pulumi up

# Preview changes
pulumi preview

# Destroy resources (if needed)
pulumi destroy
```

### Lambda Updates

```bash
cd lambda
yarn build
pulumi up
```

### Discord Bot Updates

```bash
cd discord
yarn deploy
```

## 📝 Configuration Reference

### Required Configuration

- `foundry-hosting:domainName` - Base domain for user subdomains
- `foundry-hosting:route53HostedZoneId` - Route53 hosted zone ID
- `discord:token` - Discord bot token
- `discord:clientId` - Discord application ID

### Optional Configuration

- `discord:guildId` - Discord server ID
- `discord:categoryId` - Category for user channels
- `foundry-hosting:kofiUrl` - Ko-fi integration URL
- `foundry-hosting:kofiVerificationToken` - Ko-fi webhook token
