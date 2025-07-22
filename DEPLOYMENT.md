# Deployment Guide

Complete guide for deploying the Foundry VTT hosting platform on AWS.

## 📋 Prerequisites

### AWS Account Setup

- AWS account with appropriate permissions
- AWS CLI configured with access keys
- Pulumi CLI installed (`npm install -g @pulumi/pulumi`)

### Domain Configuration

- Domain name registered in Route53
- Route53 hosted zone created
- Domain pointing to Route53 nameservers

### Discord Application

- Discord Developer Portal account
- Discord application created
- Bot token and application ID obtained

### Foundry VTT License

- Valid Foundry VTT license key
- Admin key for initial setup

## 🚀 Step-by-Step Deployment

### 1. Clone and Setup Repository

```bash
# Clone repository
git clone <repository-url>
cd foundry-hosting

# Install dependencies
yarn install
cd lambda && yarn install && cd ..
cd discord && yarn install && cd ..
```

### 2. Configure Pulumi

```bash
# Initialize Pulumi (if not already done)
pulumi stack init development

# Set required configuration
pulumi config set foundry-hosting:domainName your-domain.com
pulumi config set foundry-hosting:route53HostedZoneId Z123456789
pulumi config set discord:token --secret your-discord-bot-token
pulumi config set discord:clientId your-discord-application-id

# Set optional configuration
pulumi config set discord:guildId your-discord-server-id
pulumi config set discord:categoryId your-discord-category-id

# Optional: Ko-fi integration
pulumi config set foundry-hosting:kofiUrl "https://ko-fi.com/yourusername"
pulumi config set foundry-hosting:kofiVerificationToken --secret "your-kofi-webhook-token"
```

### 3. Deploy Infrastructure

```bash
# Preview deployment
pulumi preview

# Deploy infrastructure
pulumi up

# Verify deployment
pulumi stack output
```

**Expected Output:**

```bash
Outputs:
  clusterName: "foundry-vtt-cluster"
  loadBalancerDns: "foundry-vtt-alb-xxx.region.elb.amazonaws.com"
  fileSystemId: "fs-xxxxxxxxx"
  lambdaFunctionName: "foundry-vtt-instance-management"
  # ... additional outputs
```

### 4. Build and Deploy Lambda

```bash
# Build Lambda function
cd lambda
yarn build

# Deploy Lambda (Pulumi will handle this automatically)
cd ..
pulumi up
```

### 5. Deploy Discord Bot

```bash
# Deploy Discord bot to ECS
cd discord
yarn deploy

# Verify bot deployment
aws ecs describe-services \
  --cluster foundry-vtt-cluster \
  --services foundry-vtt-discord-bot
```

### 6. Deploy Discord Commands

```bash
# Deploy slash commands
cd discord
yarn deploy-commands
```

### 7. Test Deployment

```bash
# Test Lambda function
aws lambda invoke \
  --function-name foundry-vtt-instance-management \
  --payload '{"action":"status","userId":"test"}' \
  response.json

# Check bot logs
aws logs describe-log-groups --log-group-name-prefix "/aws/ecs/foundry-vtt-discord-bot"
```

## 🔧 Configuration Details

### Pulumi Configuration

#### Required Settings

```bash
# Domain configuration
foundry-hosting:domainName=your-domain.com
foundry-hosting:route53HostedZoneId=Z123456789

# Discord configuration
discord:token=<encrypted-bot-token>
discord:clientId=your-application-id
```

#### Optional Settings

```bash
# Discord server configuration
discord:guildId=your-server-id
discord:categoryId=your-category-id

# Ko-fi integration
foundry-hosting:kofiUrl=https://ko-fi.com/yourusername
foundry-hosting:kofiVerificationToken=<encrypted-webhook-token>
```

### Environment Variables

#### Lambda Environment Variables

```bash
CLUSTER_NAME=foundry-vtt-cluster
TASK_SECURITY_GROUP_ID=sg-xxx
TASK_ROLE_ARN=arn:aws:iam::xxx:role/xxx
EXECUTION_ROLE_ARN=arn:aws:iam::xxx:role/xxx
PRIVATE_SUBNET_IDS=subnet-xxx,subnet-yyy
FILE_SYSTEM_ID=fs-xxx
INSTANCE_TABLE_NAME=foundry-vtt-instances
# ... additional variables set by Pulumi
```

#### Discord Bot Environment Variables

```bash
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
LAMBDA_FUNCTION_NAME=foundry-vtt-instance-management
AWS_REGION=us-east-1
# ... additional variables from Secrets Manager
```

## 🔐 Security Configuration

### IAM Permissions

The deployment creates several IAM roles with specific permissions:

#### Lambda Role

- ECS task management
- EFS access point management
- S3 bucket operations
- IAM user management
- Route53 DNS management
- ALB target group management
- DynamoDB table access
- Secrets Manager access

#### ECS Task Role

- EFS access point operations
- S3 bucket access (via IAM users)
- Lambda function invocation

#### ECS Execution Role

- ECR image pulling
- CloudWatch Logs access
- Secrets Manager access

### Network Security

#### VPC Configuration

- **CIDR Block**: 10.0.0.0/16
- **Availability Zones**: 2
- **Public Subnets**: For ALB
- **Private Subnets**: For ECS tasks
- **NAT Gateway**: Single gateway for cost optimization

#### Security Groups

- **ALB**: HTTP/HTTPS inbound, all outbound
- **ECS Tasks**: Foundry VTT port inbound, controlled outbound
- **EFS**: NFS inbound from VPC, all outbound

## 📊 Monitoring Setup

### CloudWatch Logs

#### Log Groups Created

- `/aws/ecs/foundry-vtt` - ECS task logs (3 days retention)
- `/aws/lambda/foundry-vtt-instance-management` - Lambda logs (3 days retention)
- `/aws/ecs/foundry-vtt-discord-bot` - Discord bot logs (1 day retention)

#### Log Monitoring

```bash
# View Lambda logs
aws logs tail /aws/lambda/foundry-vtt-instance-management --follow

# View Discord bot logs
aws logs tail /aws/ecs/foundry-vtt-discord-bot --follow

# View ECS task logs
aws logs tail /aws/ecs/foundry-vtt --follow
```

### CloudWatch Metrics

#### Key Metrics to Monitor

- **Lambda Duration** - Function execution time
- **Lambda Errors** - Function error rate
- **ECS CPU/Memory** - Container resource usage
- **ALB Request Count** - Load balancer traffic
- **DynamoDB Consumed Capacity** - Database usage

## 🔄 Update Procedures

### Infrastructure Updates

```bash
# Update infrastructure
pulumi up

# Preview changes first
pulumi preview

# Rollback if needed
pulumi stack export > backup.json
pulumi stack import backup.json
```

### Lambda Updates

```bash
# Update Lambda code
cd lambda
yarn build
cd ..
pulumi up
```

### Discord Bot Updates

```bash
# Update Discord bot
cd discord
yarn deploy

# Update ECS service
aws ecs update-service \
  --cluster foundry-vtt-cluster \
  --service foundry-vtt-discord-bot \
  --force-new-deployment
```

### Discord Commands Updates

```bash
# Update slash commands
cd discord
yarn deploy-commands
```

## 🧹 Cleanup Procedures

### Complete Cleanup

```bash
# Destroy all resources
pulumi destroy

# Verify cleanup
pulumi stack rm development
```

### Partial Cleanup

```bash
# Remove specific resources
pulumi destroy --target aws:ecs/service:Service:foundry-vtt-discord-bot

# Keep infrastructure, remove instances
aws dynamodb scan --table-name foundry-vtt-instances --query 'Items[].userId.S' --output text | xargs -I {} aws lambda invoke --function-name foundry-vtt-instance-management --payload '{"action":"destroy-instance","userId":"{}"}'
```

## 🚨 Troubleshooting

### Common Issues

#### Pulumi Deployment Failures

```bash
# Check Pulumi state
pulumi stack

# View detailed logs
pulumi up --verbose=3

# Refresh state
pulumi refresh
```

#### Lambda Function Issues

```bash
# Check Lambda logs
aws logs tail /aws/lambda/foundry-vtt-instance-management --follow

# Test Lambda function
aws lambda invoke \
  --function-name foundry-vtt-instance-management \
  --payload '{"action":"status","userId":"test"}' \
  response.json
```

#### Discord Bot Issues

```bash
# Check bot logs
aws logs tail /aws/ecs/foundry-vtt-discord-bot --follow

# Check ECS service status
aws ecs describe-services \
  --cluster foundry-vtt-cluster \
  --services foundry-vtt-discord-bot

# Restart bot service
aws ecs update-service \
  --cluster foundry-vtt-cluster \
  --service foundry-vtt-discord-bot \
  --force-new-deployment
```

#### Network Issues

```bash
# Check security groups
aws ec2 describe-security-groups --filters "Name=group-name,Values=*foundry*"

# Check VPC configuration
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*foundry*"

# Check ALB health
aws elbv2 describe-target-health \
  --target-group-arn $(aws elbv2 describe-target-groups --names foundry-vtt-tg --query 'TargetGroups[0].TargetGroupArn' --output text)
```

### Performance Optimization

#### Cost Optimization

```bash
# Monitor costs
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost

# Optimize ECS tasks
# Consider Fargate Spot for non-critical workloads
# Use ARM64 architecture for cost efficiency
```

#### Resource Optimization

```bash
# Monitor ECS resource usage
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ClusterName,Value=foundry-vtt-cluster \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 3600 \
  --statistics Average
```

## 📝 Post-Deployment Checklist

- [ ] Infrastructure deployed successfully
- [ ] Lambda function responding to test calls
- [ ] Discord bot online and responding to commands
- [ ] Discord slash commands deployed
- [ ] SSL certificate validated
- [ ] DNS records created
- [ ] EFS file system accessible
- [ ] DynamoDB tables created
- [ ] CloudWatch logs configured
- [ ] Test instance creation works
- [ ] Test instance startup works
- [ ] Test instance access works
- [ ] Monitoring alerts configured (optional)
- [ ] Backup procedures documented
- [ ] Team access configured
- [ ] Documentation updated
