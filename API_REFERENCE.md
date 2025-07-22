# API Reference

Complete reference for the Foundry VTT hosting platform Lambda API.

## 🔗 Base Information

- **Service**: AWS Lambda Function
- **Function Name**: `foundry-vtt-instance-management`
- **Runtime**: Node.js 18.x
- **Timeout**: 300 seconds (5 minutes)
- **Memory**: 512 MB (default)

## 📡 API Endpoints

All API calls are made via AWS Lambda invocation with JSON payloads.

### Instance Management

#### Create Instance

Creates a new Foundry VTT instance for a user.

```typescript
POST /
  {
    action: "create-instance",
    userId: string,
    username: string,
    foundryLicense: string,
    foundryAdminKey: string,
    foundryVersion: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID
- `username` (required): Discord username (sanitized for DNS)
- `foundryLicense` (required): Foundry VTT license key
- `foundryAdminKey` (required): Foundry admin key
- `foundryVersion` (optional): Foundry version (default: "13")

**Response:**

```typescript
{
  success: true,
  instanceUrl: "https://username.domain.com",
  message: "Instance created successfully"
}
```

**Error Response:**

```typescript
{
  success: false,
  error: "Error message",
  details?: object
}
```

#### Start Instance

Starts an existing Foundry VTT instance.

```typescript
POST /
  {
    action: "start-instance",
    userId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID

**Response:**

```typescript
{
  success: true,
  instanceUrl: "https://username.domain.com",
  status: "starting",
  message: "Instance starting..."
}
```

#### Stop Instance

Stops a running Foundry VTT instance.

```typescript
POST /
  {
    action: "stop-instance",
    userId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID

**Response:**

```typescript
{
  success: true,
  status: "stopping",
  message: "Instance stopping..."
}
```

#### Get Instance Status

Retrieves the current status of a user's instance.

```typescript
POST /
  {
    action: "status",
    userId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID

**Response:**

```typescript
{
  success: true,
  status: "running" | "stopped" | "starting" | "stopping" | "created" | "unknown",
  instanceUrl?: "https://username.domain.com",
  taskArn?: "arn:aws:ecs:region:account:task/cluster/task-id",
  licenseType?: "byol" | "pooled",
  licenseOwnerId?: string,
  accessPointId?: "fsap-xxx",
  s3BucketName?: "foundry-username-userid",
  createdAt?: number,
  lastStarted?: number,
  message?: string
}
```

#### Destroy Instance

Permanently deletes an instance and all associated resources.

```typescript
POST /
  {
    action: "destroy-instance",
    userId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID

**Response:**

```typescript
{
  success: true,
  message: "Instance and all resources destroyed successfully"
}
```

### Scheduling Management

#### Schedule Session

Schedules a Foundry VTT session to start at a specific time.

```typescript
POST /
  {
    action: "schedule-session",
    userId: string,
    startTime: number,
    duration: number,
  };
```

**Parameters:**

- `userId` (required): Discord user ID
- `startTime` (required): Unix timestamp for session start
- `duration` (required): Session duration in minutes

**Response:**

```typescript
{
  success: true,
  sessionId: "session-uuid",
  startTime: number,
  duration: number,
  message: "Session scheduled successfully"
}
```

#### Cancel Scheduled Session

Cancels a previously scheduled session.

```typescript
POST /
  {
    action: "cancel-scheduled-session",
    userId: string,
    sessionId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID
- `sessionId` (required): Session ID to cancel

**Response:**

```typescript
{
  success: true,
  message: "Scheduled session cancelled successfully"
}
```

#### Get Scheduled Sessions

Retrieves all scheduled sessions for a user.

```typescript
POST /
  {
    action: "get-scheduled-sessions",
    userId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID

**Response:**

```typescript
{
  success: true,
  sessions: [
    {
      sessionId: "session-uuid",
      startTime: number,
      duration: number,
      status: "scheduled" | "preparing" | "running" | "completed" | "cancelled"
    }
  ]
}
```

### License Management

#### Get License Pool Status

Retrieves information about license pool availability.

```typescript
POST /
  {
    action: "license-pool-status",
  };
```

**Response:**

```typescript
{
  success: true,
  totalLicenses: number,
  availableLicenses: number,
  inUseLicenses: number,
  pools: [
    {
      licenseId: "license-uuid",
      ownerId: "user-id",
      status: "available" | "in-use" | "reserved",
      currentUser?: "user-id",
      reservedUntil?: number
    }
  ]
}
```

#### Request License

Requests a license from the pool for immediate use.

```typescript
POST /
  {
    action: "request-license",
    userId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID

**Response:**

```typescript
{
  success: true,
  licenseId: "license-uuid",
  message: "License assigned successfully"
}
```

#### Release License

Releases a license back to the pool.

```typescript
POST /
  {
    action: "release-license",
    userId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID

**Response:**

```typescript
{
  success: true,
  message: "License released successfully"
}
```

### Admin Functions

#### Admin Overview

Provides comprehensive system overview for administrators.

```typescript
POST /
  {
    action: "admin-overview",
    userId: string,
  };
```

**Parameters:**

- `userId` (required): Discord user ID (must have admin role)

**Response:**

```typescript
{
  success: true,
  instances: {
    total: number,
    running: number,
    stopped: number,
    starting: number,
    stopping: number
  },
  licenses: {
    total: number,
    available: number,
    inUse: number,
    pools: Array<LicensePool>
  },
  usage: {
    totalUsers: number,
    totalHours: number,
    totalCosts: number,
    totalDonations: number,
    totalUncovered: number
  },
  topContributors: Array<{
    userId: string,
    donations: number,
    uncovered: number
  }>
}
```

#### System Health Check

Performs a comprehensive system health check.

```typescript
POST /
  {
    action: "health-check",
  };
```

**Response:**

```typescript
{
  success: true,
  status: "healthy" | "degraded" | "unhealthy",
  checks: {
    dynamodb: "healthy" | "unhealthy",
    efs: "healthy" | "unhealthy",
    ecs: "healthy" | "unhealthy",
    alb: "healthy" | "unhealthy",
    route53: "healthy" | "unhealthy"
  },
  details?: object
}
```

### Ko-fi Integration

#### Ko-fi Webhook

Handles Ko-fi donation webhooks for cost coverage.

```typescript
POST /
  {
    action: "kofi-webhook",
    body: {
      message_id: string,
      timestamp: string,
      type: "Donation",
      from_name: string,
      message: string,
      amount: string,
      url: string,
      email: string,
      currency: string,
      is_subscription_payment: boolean,
      is_first_subscription_payment: boolean,
      kofi_transaction_id: string,
      verification_token: string,
    },
  };
```

**Response:**

```typescript
{
  success: true,
  donationProcessed: boolean,
  userId?: string,
  amount?: number,
  message?: string
}
```

### System Automation

#### Auto-shutdown Check

EventBridge-triggered function to check for idle instances.

```typescript
POST /
  {
    action: "auto-shutdown-check",
    userId: "system",
  };
```

**Response:**

```typescript
{
  success: true,
  instancesChecked: number,
  instancesStopped: number,
  message: "Auto-shutdown check completed"
}
```

#### Prepare Sessions

EventBridge-triggered function to prepare upcoming scheduled sessions.

```typescript
POST /
  {
    action: "prepare-sessions",
    userId: "system",
  };
```

**Response:**

```typescript
{
  success: true,
  sessionsPrepared: number,
  instancesStarted: number,
  message: "Session preparation completed"
}
```

## 🔐 Authentication & Authorization

### IAM Permissions

The Lambda function requires the following IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RunTask",
        "ecs:StopTask",
        "ecs:DescribeTasks",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "elasticfilesystem:CreateAccessPoint",
        "elasticfilesystem:DeleteAccessPoint",
        "elasticfilesystem:DescribeAccessPoints",
        "elasticfilesystem:DescribeFileSystems",
        "elasticfilesystem:TagResource",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "secretsmanager:CreateSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:UpdateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:TagResource",
        "route53:ChangeResourceRecordSets",
        "route53:GetHostedZone",
        "route53:ListResourceRecordSets",
        "elasticloadbalancing:CreateTargetGroup",
        "elasticloadbalancing:DeleteTargetGroup",
        "elasticloadbalancing:RegisterTargets",
        "elasticloadbalancing:DeregisterTargets",
        "elasticloadbalancing:CreateRule",
        "elasticloadbalancing:DeleteRule",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeRules",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:ModifyRule",
        "elasticloadbalancing:AddTags",
        "elasticloadbalancing:RemoveTags",
        "iam:PassRole",
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:HeadBucket",
        "s3:PutBucketPolicy",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutBucketCors",
        "s3:PutBucketVersioning",
        "s3:PutBucketOwnershipControls",
        "s3:ListBucket",
        "s3:ListBucketVersions",
        "s3:DeleteObject",
        "s3:DeleteObjectVersion",
        "s3:ListObjectsV2",
        "s3:GetBucketVersioning",
        "iam:CreateUser",
        "iam:DeleteUser",
        "iam:CreateAccessKey",
        "iam:DeleteAccessKey",
        "iam:PutUserPolicy",
        "iam:DeleteUserPolicy",
        "iam:ListAccessKeys",
        "iam:TagUser"
      ],
      "Resource": "*"
    }
  ]
}
```

### Rate Limiting

- **Concurrent Executions**: Limited by AWS Lambda account limits
- **Request Rate**: No built-in rate limiting
- **Timeout**: 300 seconds per request
- **Memory**: 512 MB per execution

## 📊 Error Handling

### Error Response Format

```typescript
{
  success: false,
  error: "Human-readable error message",
  errorCode?: "VALIDATION_ERROR" | "RESOURCE_NOT_FOUND" | "PERMISSION_DENIED" | "INTERNAL_ERROR",
  details?: {
    field?: string,
    value?: any,
    suggestion?: string
  },
  requestId?: string
}
```

### Common Error Codes

- **VALIDATION_ERROR**: Invalid input parameters
- **RESOURCE_NOT_FOUND**: Instance or resource not found
- **PERMISSION_DENIED**: Insufficient permissions
- **INTERNAL_ERROR**: Unexpected system error
- **RESOURCE_CONFLICT**: Resource already exists or is in use
- **TIMEOUT_ERROR**: Operation exceeded timeout limit

### Error Recovery

- **Automatic Retries**: AWS Lambda handles retries for transient errors
- **Graceful Degradation**: Partial failures don't break entire operations
- **Resource Cleanup**: Automatic cleanup on partial failures
- **User Feedback**: Detailed error messages for debugging

## 📈 Monitoring & Logging

### CloudWatch Logs

**Log Group**: `/aws/lambda/foundry-vtt-instance-management`

**Log Format**:

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "level": "INFO",
  "requestId": "uuid",
  "action": "create-instance",
  "userId": "123456789",
  "message": "Instance creation started",
  "details": {}
}
```

### CloudWatch Metrics

**Custom Metrics**:

- `InstanceOperations` - Count of instance operations
- `ResourceUsage` - EFS, S3, ECS resource counts
- `ErrorRates` - Error rates by operation type
- `Performance` - Lambda duration and memory usage

### Log Retention

- **Retention Period**: 3 days
- **Log Level**: INFO and above
- **Structured Logging**: JSON format with request IDs

## 🔄 EventBridge Integration

### Auto-shutdown Rule

```typescript
{
  schedule: "rate(5 minutes)",
  target: {
    arn: "arn:aws:lambda:region:account:function:foundry-vtt-instance-management",
    input: {
      action: "auto-shutdown-check",
      userId: "system"
    }
  }
}
```

### Session Preparation Rule

```typescript
{
  schedule: "rate(1 minute)",
  target: {
    arn: "arn:aws:lambda:region:account:function:foundry-vtt-instance-management",
    input: {
      action: "prepare-sessions",
      userId: "system"
    }
  }
}
```

## 🧪 Testing

### Local Testing

```bash
# Test with AWS CLI
aws lambda invoke \
  --function-name foundry-vtt-instance-management \
  --payload '{"action":"status","userId":"test"}' \
  response.json

# View response
cat response.json
```

### Load Testing

```bash
# Test multiple concurrent requests
for i in {1..10}; do
  aws lambda invoke \
    --function-name foundry-vtt-instance-management \
    --payload "{\"action\":\"status\",\"userId\":\"test$i\"}" \
    "response$i.json" &
done
wait
```

### Integration Testing

```bash
# Test complete instance lifecycle
aws lambda invoke \
  --function-name foundry-vtt-instance-management \
  --payload '{"action":"create-instance","userId":"test","username":"testuser","foundryLicense":"xxx","foundryAdminKey":"xxx"}' \
  create.json

aws lambda invoke \
  --function-name foundry-vtt-instance-management \
  --payload '{"action":"start-instance","userId":"test"}' \
  start.json

aws lambda invoke \
  --function-name foundry-vtt-instance-management \
  --payload '{"action":"stop-instance","userId":"test"}' \
  stop.json

aws lambda invoke \
  --function-name foundry-vtt-instance-management \
  --payload '{"action":"destroy-instance","userId":"test"}' \
  destroy.json
```

## 📝 SDK Examples

### JavaScript/Node.js

```javascript
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const lambda = new LambdaClient({ region: "us-east-1" });

async function createInstance(userId, username, license, adminKey) {
  const command = new InvokeCommand({
    FunctionName: "foundry-vtt-instance-management",
    Payload: JSON.stringify({
      action: "create-instance",
      userId,
      username,
      foundryLicense: license,
      foundryAdminKey: adminKey,
    }),
  });

  const response = await lambda.send(command);
  return JSON.parse(new TextDecoder().decode(response.Payload));
}
```

### Python

```python
import boto3
import json

lambda_client = boto3.client('lambda')

def create_instance(user_id, username, license, admin_key):
    payload = {
        'action': 'create-instance',
        'userId': user_id,
        'username': username,
        'foundryLicense': license,
        'foundryAdminKey': admin_key
    }

    response = lambda_client.invoke(
        FunctionName='foundry-vtt-instance-management',
        Payload=json.dumps(payload)
    )

    return json.loads(response['Payload'].read())
```

### Go

```go
package main

import (
    "encoding/json"
    "github.com/aws/aws-sdk-go/aws"
    "github.com/aws/aws-sdk-go/aws/session"
    "github.com/aws/aws-sdk-go/service/lambda"
)

func createInstance(userID, username, license, adminKey string) (map[string]interface{}, error) {
    sess := session.Must(session.NewSession())
    lambdaClient := lambda.New(sess)

    payload := map[string]interface{}{
        "action":         "create-instance",
        "userId":         userID,
        "username":       username,
        "foundryLicense": license,
        "foundryAdminKey": adminKey,
    }

    payloadBytes, _ := json.Marshal(payload)

    input := &lambda.InvokeInput{
        FunctionName: aws.String("foundry-vtt-instance-management"),
        Payload:      payloadBytes,
    }

    result, err := lambdaClient.Invoke(input)
    if err != nil {
        return nil, err
    }

    var response map[string]interface{}
    json.Unmarshal(result.Payload, &response)
    return response, nil
}
```
