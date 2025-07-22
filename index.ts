// index.ts - Pulumi Infrastructure for Foundry VTT on ECS
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { NatGatewayStrategy } from "@pulumi/awsx/ec2";

const config = new pulumi.Config();
const projectName = "foundry-vtt";
const environment = pulumi.getStack();

// =================
// NETWORKING
// =================
const vpc = new awsx.ec2.Vpc(`${projectName}-vpc`, {
  cidrBlock: "10.0.0.0/16",
  numberOfAvailabilityZones: 2,
  enableDnsHostnames: true,
  enableDnsSupport: true,
  natGateways: {
    strategy: NatGatewayStrategy.Single,
  },
  tags: {
    Name: `${projectName}-vpc`,
    Environment: environment,
  },
});

// =================
// EFS FILE SYSTEM
// =================
const efsSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-efs-sg`, {
  vpcId: vpc.vpcId,
  description: "Security group for Foundry EFS",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 2049,
      toPort: 2049,
      cidrBlocks: [vpc.vpc.cidrBlock],
      description: "Allow NFS access from VPC",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: {
    Name: `${projectName}-efs-sg`,
  },
});

const fileSystem = new aws.efs.FileSystem(`${projectName}-efs`, {
  performanceMode: "generalPurpose",
  throughputMode: "bursting",
  encrypted: true,
  lifecyclePolicies: [
    {
      transitionToIa: "AFTER_30_DAYS",
    },
  ],
  tags: {
    Name: `${projectName}-efs`,
    Environment: environment,
  },
});

// EFS Mount Targets
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

// =================
// APPLICATION LOAD BALANCER
// =================
const albSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-alb-sg`, {
  vpcId: vpc.vpcId,
  description: "Security group for Foundry ALB",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow HTTP access",
    },
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow HTTPS access",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: {
    Name: `${projectName}-alb-sg`,
  },
});

const loadBalancer = new aws.lb.LoadBalancer(`${projectName}-alb`, {
  internal: false,
  loadBalancerType: "application",
  securityGroups: [albSecurityGroup.id],
  subnets: vpc.publicSubnetIds,
  enableDeletionProtection: false, // Set to true in production
  tags: {
    Name: `${projectName}-alb`,
    Environment: environment,
  },
});

// Create wildcard SSL certificate for all user subdomains
const domainName = config.require("domainName");
const hostedZoneId = config.require("route53HostedZoneId");

const wildcardCertificate = new aws.acm.Certificate(
  `${projectName}-wildcard-cert`,
  {
    domainName: `*.${domainName}`,
    subjectAlternativeNames: [domainName], // Also cover the base domain
    validationMethod: "DNS",
    tags: {
      Name: `${projectName}-wildcard-cert`,
      Environment: environment,
    },
  }
);

// Create DNS validation records
const certValidationRecords = wildcardCertificate.domainValidationOptions.apply(
  (options) =>
    options.map(
      (option, index) =>
        new aws.route53.Record(`${projectName}-cert-validation-${index}`, {
          allowOverwrite: true,
          name: option.resourceRecordName,
          records: [option.resourceRecordValue],
          ttl: 60,
          type: option.resourceRecordType,
          zoneId: hostedZoneId,
        })
    )
);

// Certificate validation
const certValidation = new aws.acm.CertificateValidation(
  `${projectName}-cert-validation`,
  {
    certificateArn: wildcardCertificate.arn,
    validationRecordFqdns: certValidationRecords.apply((records) =>
      records.map((record) => record.fqdn)
    ),
  }
);

// HTTPS Listener for ALB
const httpsListener = new aws.lb.Listener(
  `${projectName}-https-listener`,
  {
    loadBalancerArn: loadBalancer.arn,
    port: 443,
    protocol: "HTTPS",
    sslPolicy: "ELBSecurityPolicy-TLS-1-2-2017-01",
    certificateArn: certValidation.certificateArn,
    defaultActions: [
      {
        type: "fixed-response",
        fixedResponse: {
          contentType: "text/plain",
          messageBody: "Not Found",
          statusCode: "404",
        },
      },
    ],
    tags: {
      Name: `${projectName}-https-listener`,
      Environment: environment,
    },
  },
  {
    dependsOn: [certValidation],
  }
);

// =================
// ECS CLUSTER
// =================
const cluster = new aws.ecs.Cluster(`${projectName}-cluster`, {
  name: `${projectName}-cluster`,
  tags: {
    Name: `${projectName}-cluster`,
    Environment: environment,
  },
});

// =================
// IAM ROLES
// =================

// Task execution role (for pulling images, logs, secrets)
const executionRole = new aws.iam.Role(`${projectName}-execution-role`, {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "ecs-tasks.amazonaws.com",
        },
      },
    ],
  }),
  tags: {
    Name: `${projectName}-execution-role`,
  },
});

new aws.iam.RolePolicyAttachment(`${projectName}-execution-role-policy`, {
  role: executionRole.name,
  policyArn:
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

// Add to your executionRole policy
new aws.iam.RolePolicy(`${projectName}-execution-logs-policy`, {
  role: executionRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        Resource: "*",
      },
    ],
  }),
});

// Additional permissions for secrets manager
new aws.iam.RolePolicy(`${projectName}-execution-secrets-policy`, {
  role: executionRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: "*",
      },
    ],
  }),
});

// Task role (for runtime permissions)
const taskRole = new aws.iam.Role(`${projectName}-task-role`, {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "ecs-tasks.amazonaws.com",
        },
      },
    ],
  }),
  tags: {
    Name: `${projectName}-task-role`,
  },
});

// EFS permissions for task role
new aws.iam.RolePolicy(`${projectName}-task-efs-policy`, {
  role: taskRole.id,
  policy: pulumi.all([fileSystem.arn]).apply(([efsArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "elasticfilesystem:CreateAccessPoint",
            "elasticfilesystem:DescribeAccessPoints",
            "elasticfilesystem:DescribeFileSystems",
          ],
          Resource: efsArn,
        },
        {
          Effect: "Allow",
          Action: [
            "elasticfilesystem:TagResource",
            "elasticfilesystem:DescribeAccessPoints",
            "elasticfilesystem:DeleteAccessPoint",
          ],
          Resource: efsArn
            .replace("file-system", "access-point")
            .replace("fs-", "fsap-*"),
        },
      ],
    })
  ),
});

// =================
// SECURITY GROUP FOR ECS TASKS
// =================
const taskSecurityGroup = new aws.ec2.SecurityGroup(`${projectName}-task-sg`, {
  vpcId: vpc.vpcId,
  description: "Security group for Foundry ECS tasks",
  ingress: [
    {
      protocol: "tcp",
      fromPort: 30000,
      toPort: 30000,
      securityGroups: [albSecurityGroup.id],
      description: "Allow Foundry access from ALB",
    },
  ],
  egress: [
    {
      protocol: "tcp",
      fromPort: 2049,
      toPort: 2049,
      securityGroups: [efsSecurityGroup.id],
      description: "Allow EFS access",
    },
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow HTTPS outbound",
    },
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow HTTP outbound",
    },
    {
      protocol: "udp",
      fromPort: 53,
      toPort: 53,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow DNS queries",
    },
    {
      protocol: "tcp",
      fromPort: 53,
      toPort: 53,
      cidrBlocks: ["0.0.0.0/0"],
      description: "Allow DNS queries over TCP",
    },
  ],
  tags: {
    Name: `${projectName}-task-sg`,
  },
});

// =================
// DYNAMODB TABLES
// =================

// Main instance tracking table
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
  serverSideEncryption: {
    enabled: true,
  },
  pointInTimeRecovery: {
    enabled: true,
  },
  ttl: {
    attributeName: "ttl",
    enabled: true,
  },
  tags: {
    Name: `${projectName}-instances`,
    Environment: environment,
  },
});

// License pool table
const licensePoolTable = new aws.dynamodb.Table(`${projectName}-license-pool`, {
  name: `${projectName}-instances-license-pool`,
  billingMode: "PAY_PER_REQUEST",
  hashKey: "licenseId",
  attributes: [
    { name: "licenseId", type: "S" },
    { name: "ownerId", type: "S" },
  ],
  globalSecondaryIndexes: [
    {
      name: "ownerId-index",
      hashKey: "ownerId",
      projectionType: "ALL",
    },
  ],
  serverSideEncryption: {
    enabled: true,
  },
  tags: {
    Name: `${projectName}-license-pool`,
    Environment: environment,
  },
});

// Scheduled sessions table
const scheduledSessionsTable = new aws.dynamodb.Table(
  `${projectName}-scheduled-sessions`,
  {
    name: `${projectName}-instances-scheduled-sessions`,
    billingMode: "PAY_PER_REQUEST",
    hashKey: "sessionId",
    attributes: [
      { name: "sessionId", type: "S" },
      { name: "userId", type: "S" },
      { name: "startTime", type: "N" },
    ],
    globalSecondaryIndexes: [
      {
        name: "userId-index",
        hashKey: "userId",
        projectionType: "ALL",
      },
      {
        name: "startTime-index",
        hashKey: "startTime",
        projectionType: "ALL",
      },
    ],
    serverSideEncryption: {
      enabled: true,
    },
    tags: {
      Name: `${projectName}-scheduled-sessions`,
      Environment: environment,
    },
  }
);

// License reservations table
const licenseReservationsTable = new aws.dynamodb.Table(
  `${projectName}-license-reservations`,
  {
    name: `${projectName}-instances-license-reservations`,
    billingMode: "PAY_PER_REQUEST",
    hashKey: "reservationId",
    attributes: [
      { name: "reservationId", type: "S" },
      { name: "licenseId", type: "S" },
      { name: "startTime", type: "N" },
    ],
    globalSecondaryIndexes: [
      {
        name: "licenseId-startTime-index",
        hashKey: "licenseId",
        rangeKey: "startTime",
        projectionType: "ALL",
      },
    ],
    serverSideEncryption: {
      enabled: true,
    },
    tags: {
      Name: `${projectName}-license-reservations`,
      Environment: environment,
    },
  }
);

// Usage tracking table
const usageTable = new aws.dynamodb.Table(`${projectName}-usage`, {
  name: `${projectName}-usage`,
  billingMode: "PAY_PER_REQUEST",
  hashKey: "usageKey",
  attributes: [{ name: "usageKey", type: "S" }],
  serverSideEncryption: { enabled: true },
  tags: {
    Name: `${projectName}-usage`,
    Environment: environment,
  },
});

// Bot configuration table (stores registration message IDs, etc.)
const botConfigTable = new aws.dynamodb.Table(`${projectName}-bot-config`, {
  name: `${projectName}-bot-config`,
  billingMode: "PAY_PER_REQUEST",
  hashKey: "configKey",
  attributes: [{ name: "configKey", type: "S" }],
  serverSideEncryption: { enabled: true },
  tags: {
    Name: `${projectName}-bot-config`,
    Environment: environment,
  },
});

// Legacy schedule tracking table (keeping for backward compatibility)
const scheduleTable = new aws.dynamodb.Table(`${projectName}-schedules`, {
  name: `${projectName}-schedules`,
  billingMode: "PAY_PER_REQUEST",
  hashKey: "scheduleId",
  rangeKey: "userId",
  attributes: [
    { name: "scheduleId", type: "S" },
    { name: "userId", type: "S" },
  ],
  serverSideEncryption: {
    enabled: true,
  },
  tags: {
    Name: `${projectName}-schedules`,
    Environment: environment,
  },
});

// =================
// LAMBDA FUNCTION
// =================

// Lambda execution role
const lambdaRole = new aws.iam.Role(`${projectName}-lambda-role`, {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "lambda.amazonaws.com",
        },
      },
    ],
  }),
  tags: {
    Name: `${projectName}-lambda-role`,
  },
});

new aws.iam.RolePolicyAttachment(`${projectName}-lambda-basic-policy`, {
  role: lambdaRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
});

// Lambda permissions for managing resources
new aws.iam.RolePolicy(`${projectName}-lambda-permissions`, {
  role: lambdaRole.id,
  policy: pulumi
    .all([
      cluster.arn,
      instanceTable.arn,
      fileSystem.arn,
      taskRole.arn,
      executionRole.arn,
    ])
    .apply(([clusterArn, tableArn, efsArn, taskRoleArn, executionRoleArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              // ECS permissions
              "ecs:RunTask",
              "ecs:StopTask",
              "ecs:DescribeTasks",
              "ecs:DescribeTaskDefinition",
              "ecs:RegisterTaskDefinition",
              // EFS permissions
              "elasticfilesystem:CreateAccessPoint",
              "elasticfilesystem:DeleteAccessPoint",
              "elasticfilesystem:DescribeAccessPoints",
              "elasticfilesystem:DescribeFileSystems",
              "elasticfilesystem:TagResource",
              // DynamoDB permissions
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:UpdateItem",
              "dynamodb:DeleteItem",
              "dynamodb:Query",
              "dynamodb:Scan",
              // Secrets Manager permissions
              "secretsmanager:CreateSecret",
              "secretsmanager:GetSecretValue",
              "secretsmanager:UpdateSecret",
              "secretsmanager:DeleteSecret",
              "secretsmanager:TagResource",
              // Route53 permissions (for DNS)
              "route53:ChangeResourceRecordSets",
              "route53:GetHostedZone",
              "route53:ListResourceRecordSets",
              // Elastic Load Balancing permissions (for ALB)
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
              // IAM permissions for task roles
              "iam:PassRole",
              // S3 permissions for static assets
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
              // IAM permissions for per-instance users
              "iam:CreateUser",
              "iam:DeleteUser",
              "iam:CreateAccessKey",
              "iam:DeleteAccessKey",
              "iam:PutUserPolicy",
              "iam:DeleteUserPolicy",
              "iam:ListAccessKeys",
              "iam:TagUser",
            ],
            Resource: "*", // TODO: Scope down in production
          },
        ],
      })
    ),
});

// Lambda function for instance management
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
    timeout: 300, // 5 minutes
    environment: {
      variables: {
        CLUSTER_NAME: cluster.name,
        INSTANCE_TABLE_NAME: instanceTable.name,
        SCHEDULE_TABLE_NAME: scheduleTable.name,
        LICENSE_POOL_TABLE_NAME: licensePoolTable.name,
        SCHEDULED_SESSIONS_TABLE_NAME: scheduledSessionsTable.name,
        LICENSE_RESERVATIONS_TABLE_NAME: licenseReservationsTable.name,
        USAGE_TABLE_NAME: usageTable.name,
        FILE_SYSTEM_ID: fileSystem.id,
        VPC_ID: vpc.vpcId,
        PRIVATE_SUBNET_IDS: vpc.privateSubnetIds.apply((ids) => ids.join(",")),
        TASK_SECURITY_GROUP_ID: taskSecurityGroup.id,
        TASK_ROLE_ARN: taskRole.arn,
        EXECUTION_ROLE_ARN: executionRole.arn,
        LOAD_BALANCER_ARN: loadBalancer.arn,
        ALB_DNS_NAME: loadBalancer.dnsName,
        ALB_ZONE_ID: loadBalancer.zoneId,
        ALB_HTTPS_LISTENER_ARN: httpsListener.arn,
        ROUTE53_HOSTED_ZONE_ID: hostedZoneId,
        DOMAIN_NAME: domainName,
        // Ko-fi integration
        KOFI_VERIFICATION_TOKEN: config.get("kofiVerificationToken") || "",
        KOFI_URL: config.get("kofiUrl") || "",
        // Cost configuration
        INSTANCE_COST_PER_HOUR: "1.00",
      },
    },
    tags: {
      Name: `${projectName}-instance-lambda`,
      Environment: environment,
    },
  },
  {
    dependsOn: mountTargets,
  }
);

// Task definitions will be created dynamically by the Lambda function
// when instances are started, with proper access point IDs

// CloudWatch Log Group for ECS tasks
const logGroup = new aws.cloudwatch.LogGroup(`${projectName}-ecs-logs`, {
  name: `/aws/ecs/${projectName}`,
  retentionInDays: 3, // Reduced from 7 days to minimize storage costs
  tags: {
    Name: `${projectName}-ecs-logs`,
    Environment: environment,
  },
});

// =================
// ROUTE 53 (Optional - add your domain)
// =================
// Uncomment and modify if you have a domain
/*
const zone = aws.route53.getZone({
  name: "yourdomain.com",
  privateZone: false,
});

const albRecord = new aws.route53.Record(`${projectName}-alb-record`, {
  zoneId: zone.then(z => z.zoneId),
  name: `*.foundry.yourdomain.com`,
  type: "A",
  aliases: [
    {
      name: loadBalancer.dnsName,
      zoneId: loadBalancer.zoneId,
      evaluateTargetHealth: true,
    },
  ],
});
*/

// Add to your existing Pulumi index.ts

// =================
// DISCORD BOT CONFIGURATION
// =================
const discordConfig = new pulumi.Config("discord");

// Store Discord secrets in AWS Secrets Manager via Pulumi
const discordBotSecrets = new aws.secretsmanager.Secret(
  `${projectName}-discord-bot-secrets`,
  {
    name: `${projectName}-discord-bot-secrets`,
    description: "Discord bot credentials for Foundry VTT management",
    tags: {
      Name: `${projectName}-discord-bot-secrets`,
      Environment: environment,
    },
  }
);

const discordBotSecretVersion = new aws.secretsmanager.SecretVersion(
  `${projectName}-discord-bot-secret-version`,
  {
    secretId: discordBotSecrets.id,
    secretString: pulumi.jsonStringify({
      DISCORD_TOKEN: discordConfig.requireSecret("token"),
      DISCORD_CLIENT_ID: discordConfig.require("clientId"),
      DISCORD_GUILD_ID: discordConfig.get("guildId") || "", // Optional for global deployment
      FOUNDRY_CATEGORY_ID: discordConfig.get("categoryId") || "", // Optional category for organizing channels
      ALLOWED_ROLES: discordConfig.get("allowedRoles") || "",
      ADMIN_ROLES: discordConfig.get("adminRoles") || "Admin",
      KOFI_URL: config.get("kofiUrl") || "",
    }),
  }
);

// =================
// ECR REPOSITORY FOR DISCORD BOT
// =================
const discordBotRepo = new aws.ecr.Repository(
  `${projectName}-discord-bot-repo`,
  {
    name: `${projectName}-discord-bot`,
    imageScanningConfiguration: {
      scanOnPush: true,
    },
    imageTagMutability: "MUTABLE",
    tags: {
      Name: `${projectName}-discord-bot-repo`,
      Environment: environment,
    },
  }
);

// =================
// DISCORD BOT TASK DEFINITION
// =================
const discordBotTaskDefinition = new aws.ecs.TaskDefinition(
  `${projectName}-discord-bot-task`,
  {
    family: `${projectName}-discord-bot`,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "256", // MINIMUM for Fargate ARM64 - cannot be reduced further
    memory: "512", // MINIMUM for 256 CPU - cannot be reduced further
    executionRoleArn: executionRole.arn,
    taskRoleArn: taskRole.arn, // Same role as Foundry instances - can invoke Lambda
    runtimePlatform: {
      cpuArchitecture: "ARM64", // Use ARM64 for cheaper Graviton instances
      operatingSystemFamily: "LINUX",
    },
    containerDefinitions: pulumi
      .all([
        discordBotRepo.repositoryUrl,
        instanceManagementLambda.name,
        discordBotSecrets.arn,
        botConfigTable.name,
      ])
      .apply(([repoUrl, lambdaName, secretArn, tableName]) =>
        JSON.stringify([
          {
            name: "discord-bot",
            image: `${repoUrl}:latest`,
            essential: true,
            logConfiguration: {
              logDriver: "awslogs",
              options: {
                "awslogs-group": `/aws/ecs/${projectName}-discord-bot`,
                "awslogs-region": aws.config.region,
                "awslogs-stream-prefix": "discord-bot",
                "awslogs-create-group": "true",
              },
            },
            environment: [
              {
                name: "AWS_REGION",
                value: aws.config.region || "us-east-1",
              },
              {
                name: "LAMBDA_FUNCTION_NAME",
                value: lambdaName,
              },
              {
                name: "NODE_ENV",
                value: "production",
              },
              {
                name: "BOT_CONFIG_TABLE_NAME",
                value: tableName,
              },
              {
                name: "INSTANCE_COST_PER_HOUR",
                value: "1.00",
              },
            ],
            secrets: [
              {
                name: "DISCORD_TOKEN",
                valueFrom: `${secretArn}:DISCORD_TOKEN::`,
              },
              {
                name: "DISCORD_CLIENT_ID",
                valueFrom: `${secretArn}:DISCORD_CLIENT_ID::`,
              },
              {
                name: "DISCORD_GUILD_ID",
                valueFrom: `${secretArn}:DISCORD_GUILD_ID::`,
              },
              {
                name: "FOUNDRY_CATEGORY_ID",
                valueFrom: `${secretArn}:FOUNDRY_CATEGORY_ID::`,
              },
              {
                name: "ALLOWED_ROLES",
                valueFrom: `${secretArn}:ALLOWED_ROLES::`,
              },
              {
                name: "ADMIN_ROLES",
                valueFrom: `${secretArn}:ADMIN_ROLES::`,
              },
              {
                name: "KOFI_URL",
                valueFrom: `${secretArn}:KOFI_URL::`,
              },
            ],
            healthCheck: {
              command: [
                "CMD-SHELL",
                "node -e \"console.log('healthy')\" || exit 1",
              ],
              interval: 120, // Increased from 30s to 2min to reduce CPU overhead
              timeout: 10, // Slightly increased timeout
              retries: 2, // Reduced retries from 3 to 2
              startPeriod: 60,
            },
          },
        ])
      ),
    tags: {
      Name: `${projectName}-discord-bot-task`,
      Environment: environment,
    },
  }
);

// =================
// DISCORD BOT SERVICE
// =================
const discordBotService = new aws.ecs.Service(
  `${projectName}-discord-bot-service`,
  {
    name: `${projectName}-discord-bot`,
    cluster: cluster.arn,
    taskDefinition: discordBotTaskDefinition.arn,
    launchType: "FARGATE", // Could consider FARGATE_SPOT for ~70% cost savings, but impacts availability
    desiredCount: 1, // Minimum for high availability
    networkConfiguration: {
      subnets: vpc.privateSubnetIds,
      securityGroups: [taskSecurityGroup.id], // Same security group as Foundry instances
      assignPublicIp: false,
    },
    enableExecuteCommand: true,
    deploymentMaximumPercent: 200,
    deploymentMinimumHealthyPercent: 0,
    enableEcsManagedTags: true,
    propagateTags: "SERVICE",
    tags: {
      Name: `${projectName}-discord-bot-service`,
      Environment: environment,
    },
  }
);

// =================
// CLOUDWATCH LOG GROUP FOR DISCORD BOT
// =================
const discordBotLogGroup = new aws.cloudwatch.LogGroup(
  `${projectName}-discord-bot-logs`,
  {
    name: `/aws/ecs/${projectName}-discord-bot`,
    retentionInDays: 1, // Minimal retention for Discord bot logs to reduce costs
    tags: {
      Name: `${projectName}-discord-bot-logs`,
      Environment: environment,
    },
  }
);

// =================
// UPDATE LAMBDA PERMISSIONS FOR DISCORD BOT
// =================
// Add permissions for Discord bot to invoke Lambda
new aws.iam.RolePolicy(`${projectName}-task-lambda-invoke-policy`, {
  role: taskRole.id,
  policy: pulumi.all([instanceManagementLambda.arn]).apply(([lambdaArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["lambda:InvokeFunction"],
          Resource: lambdaArn,
        },
      ],
    })
  ),
});

// IAM: add dynamodb access for bot task role
new aws.iam.RolePolicy(`${projectName}-task-botconfig-policy`, {
  role: taskRole.id,
  policy: pulumi.all([botConfigTable.arn]).apply(([tableArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:Scan",
            "dynamodb:Query",
          ],
          Resource: tableArn,
        },
      ],
    })
  ),
});

// =================
// UPDATED EXPORTS FOR DISCORD BOT
// =================
export const discordBotOutputs = {
  // ECR Repository info
  ecrRepository: {
    url: discordBotRepo.repositoryUrl,
    name: discordBotRepo.name,
  },

  // ECS Service info
  service: {
    name: discordBotService.name,
    arn: discordBotService.id,
  },

  // Task definition
  taskDefinition: {
    arn: discordBotTaskDefinition.arn,
    family: discordBotTaskDefinition.family,
  },

  // Secrets
  secretsArn: discordBotSecrets.arn,

  // Deployment commands
  deploymentCommands: {
    buildImage: `docker build -t ${projectName}-discord-bot ./discord-bot`,
    tagImage: discordBotRepo.repositoryUrl.apply(
      (url) => `docker tag ${projectName}-discord-bot:latest ${url}:latest`
    ),
    pushImage: discordBotRepo.repositoryUrl.apply(
      (url) => `docker push ${url}:latest`
    ),
    ecrLogin: discordBotRepo.registryId.apply(
      (id) =>
        `aws ecr get-login-password --region ${aws.config.region} | docker login --username AWS --password-stdin ${id}.dkr.ecr.${aws.config.region}.amazonaws.com`
    ),
  },
};

// =================
// EVENTBRIDGE SCHEDULED RULES FOR AUTO-SHUTDOWN
// =================

// EventBridge rule for auto-shutdown check (every 5 minutes)
const autoShutdownRule = new aws.cloudwatch.EventRule(
  `${projectName}-auto-shutdown-rule`,
  {
    description: "Trigger auto-shutdown check every 5 minutes",
    scheduleExpression: "rate(5 minutes)",
    tags: {
      Name: `${projectName}-auto-shutdown-rule`,
      Environment: environment,
    },
  }
);

// Permission for EventBridge to invoke Lambda
const autoShutdownLambdaPermission = new aws.lambda.Permission(
  `${projectName}-auto-shutdown-lambda-permission`,
  {
    statementId: "AllowExecutionFromCloudWatch",
    action: "lambda:InvokeFunction",
    function: instanceManagementLambda.name,
    principal: "events.amazonaws.com",
    sourceArn: autoShutdownRule.arn,
  }
);

// EventBridge target for auto-shutdown
const autoShutdownTarget = new aws.cloudwatch.EventTarget(
  `${projectName}-auto-shutdown-target`,
  {
    rule: autoShutdownRule.name,
    arn: instanceManagementLambda.arn,
    input: JSON.stringify({
      action: "auto-shutdown-check",
      userId: "system",
    }),
  }
);

// EventBridge rule for session preparation (every minute)
const sessionPrepRule = new aws.cloudwatch.EventRule(
  `${projectName}-session-prep-rule`,
  {
    description: "Prepare upcoming scheduled sessions every minute",
    scheduleExpression: "rate(1 minute)",
    tags: {
      Name: `${projectName}-session-prep-rule`,
      Environment: environment,
    },
  }
);

// Permission for session prep EventBridge to invoke Lambda
const sessionPrepLambdaPermission = new aws.lambda.Permission(
  `${projectName}-session-prep-lambda-permission`,
  {
    statementId: "AllowSessionPrepFromCloudWatch",
    action: "lambda:InvokeFunction",
    function: instanceManagementLambda.name,
    principal: "events.amazonaws.com",
    sourceArn: sessionPrepRule.arn,
  }
);

// EventBridge target for session preparation
const sessionPrepTarget = new aws.cloudwatch.EventTarget(
  `${projectName}-session-prep-target`,
  {
    rule: sessionPrepRule.name,
    arn: instanceManagementLambda.arn,
    input: JSON.stringify({
      action: "prepare-sessions",
      userId: "system",
    }),
  }
);

// =================
// EXPORTS
// =================
export const clusterName = cluster.name;
export const loadBalancerDns = loadBalancer.dnsName;
export const fileSystemId = fileSystem.id;
export const instanceTableName = instanceTable.name;
export const scheduleTableName = scheduleTable.name;
export const licensePoolTableName = licensePoolTable.name;
export const scheduledSessionsTableName = scheduledSessionsTable.name;
export const licenseReservationsTableName = licenseReservationsTable.name;
export const botConfigTableName = botConfigTable.name;
export const lambdaFunctionName = instanceManagementLambda.name;
export const vpcId = vpc.vpcId;
export const privateSubnetIds = vpc.privateSubnetIds;
export const taskSecurityGroupId = taskSecurityGroup.id;
export const taskRoleArn = taskRole.arn;
export const executionRoleArn = executionRole.arn;
export const wildcardCertificateArn = wildcardCertificate.arn;
export const httpsListenerArn = httpsListener.arn;
export const foundryDomain = domainName;
export const foundrySubdomain = pulumi.interpolate`*.${domainName}`;

// Outputs for easy access
export const outputs = {
  cluster: {
    name: clusterName,
    arn: cluster.arn,
  },
  loadBalancer: {
    dns: loadBalancerDns,
    arn: loadBalancer.arn,
  },
  storage: {
    fileSystemId: fileSystemId,
    instanceTable: instanceTableName,
    scheduleTable: scheduleTableName,
    licensePoolTable: licensePoolTableName,
    scheduledSessionsTable: scheduledSessionsTableName,
    licenseReservationsTable: licenseReservationsTableName,
    botConfigTable: botConfigTableName,
    usageTable: usageTable.name,
  },
  lambda: {
    functionName: lambdaFunctionName,
    arn: instanceManagementLambda.arn,
  },
  network: {
    vpcId: vpcId,
    privateSubnetIds: privateSubnetIds,
    taskSecurityGroupId: taskSecurityGroupId,
  },
  iam: {
    taskRoleArn: taskRoleArn,
    executionRoleArn: executionRoleArn,
  },
  ssl: {
    certificateArn: wildcardCertificateArn,
    listenerArn: httpsListenerArn,
    domain: foundryDomain,
    wildcardDomain: foundrySubdomain,
  },
};
