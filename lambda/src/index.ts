import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { ECSManager } from "./utils/ecs-manager";
import { EFSManager } from "./utils/efs-manager";
import { SecretsManager } from "./utils/secrets-manager";
import { DynamoDBManager } from "./utils/dynamodb-manager";
import { ALBManager } from "./utils/alb-manager";
import { Route53Manager } from "./utils/route53-manager";
import { TaskManager } from "./utils/task-manager";
import { S3Manager } from "./utils/s3-manager";
import { IAMManager } from "./utils/iam-manager";

interface FoundryEvent {
  action:
    | "create"
    | "start"
    | "stop"
    | "destroy"
    | "delete"
    | "status"
    | "list-all"
    | "update-version";
  userId: string;
  sanitizedUsername?: string;
  foundryUsername?: string;
  foundryPassword?: string;
  foundryVersion?: string;
}

const ecsManager = new ECSManager(process.env.CLUSTER_NAME!);
const efsManager = new EFSManager(process.env.FILE_SYSTEM_ID!);
const secretsManager = new SecretsManager();
const dynamoManager = new DynamoDBManager(process.env.INSTANCE_TABLE_NAME!);
const albManager = new ALBManager(
  process.env.LOAD_BALANCER_ARN!,
  process.env.VPC_ID!
);
const route53Manager = new Route53Manager(
  process.env.ROUTE53_HOSTED_ZONE_ID!,
  process.env.DOMAIN_NAME!
);
const taskManager = new TaskManager(process.env.CLUSTER_NAME!);
const s3Manager = new S3Manager();
const iamManager = new IAMManager();

export const handler = async (
  event: FoundryEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  console.log("Received event:", JSON.stringify(event));

  try {
    const { action, userId } = event;

    if (!action || !userId) {
      return errorResponse(400, "Missing required parameters: action, userId");
    }

    let result;
    switch (action) {
      case "create":
        result = await createInstance(userId, event);
        break;
      case "start":
        result = await startInstance(userId);
        break;
      case "stop":
        result = await stopInstance(userId);
        break;
      case "destroy":
        result = await destroyInstance(userId);
        break;
      case "delete":
        result = await deleteUser(userId);
        break;
      case "status":
        result = await getInstanceStatus(userId);
        break;
      case "list-all":
        result = await getAllInstances();
        break;
      case "update-version":
        result = await updateInstanceVersion(userId, event.foundryVersion!);
        break;
      default:
        return errorResponse(400, `Unknown action: ${action}`);
    }

    return successResponse(result);
  } catch (error) {
    console.error("Error handling request:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return errorResponse(500, `Internal error: ${errorMessage}`);
  }
};

async function createInstance(userId: string, event: FoundryEvent) {
  // Check if user already has an instance
  const existing = await dynamoManager.getInstance(userId);
  if (existing) {
    throw new Error("User already has an instance");
  }

  const { foundryUsername, foundryPassword, sanitizedUsername } = event;
  if (!foundryUsername || !foundryPassword) {
    throw new Error("Missing Foundry credentials");
  }

  if (!sanitizedUsername) {
    throw new Error("Missing sanitized username");
  }

  // Create EFS access point
  const accessPointId = await efsManager.createAccessPoint(userId);
  console.log(`Created access point: ${accessPointId}`);

  if (!accessPointId || accessPointId.includes("${")) {
    throw new Error(`Invalid access point ID received: ${accessPointId}`);
  }

  // Check if user had previous credentials and reuse admin key
  let adminKey: string;
  let secretArn: string;

  try {
    const existingCredentials = await secretsManager.getCredentials(userId);
    if (existingCredentials?.admin_key) {
      console.log(`Reusing existing admin key for user: ${userId}`);
      adminKey = existingCredentials.admin_key;
    } else {
      adminKey = generateAdminKey();
      console.log(`Generated new admin key for user: ${userId}`);
    }
  } catch (error) {
    // No existing credentials, generate new admin key
    adminKey = generateAdminKey();
    console.log(`Generated new admin key for user: ${userId}`);
  }

  // Store credentials in Secrets Manager
  secretArn = await secretsManager.storeCredentials(
    userId,
    foundryUsername,
    foundryPassword,
    adminKey
  );

  // Create S3 bucket for static assets
  const s3BucketName = await s3Manager.createFoundryBucket(
    userId,
    sanitizedUsername
  );
  console.log(`Created S3 bucket: ${s3BucketName}`);

  // Create IAM user with S3 access
  const s3Credentials = await iamManager.createFoundryUser(
    userId,
    sanitizedUsername,
    s3BucketName
  );
  console.log(`Created IAM user with S3 access`);

  // Create ALB target group for this user
  const targetGroupArn = await albManager.createUserTargetGroup(
    sanitizedUsername
  );

  // Get next available ALB rule priority
  const priority = await albManager.getNextAvailablePriority();

  // Create instance record with ALB and S3 info
  const instance = await dynamoManager.createInstance({
    userId,
    sanitizedUsername,
    status: "created",
    accessPointId,
    secretArn,
    adminKey,
    foundryVersion: "13", // Default to latest stable version
    s3BucketName,
    s3AccessKeyId: s3Credentials.accessKeyId,
    s3SecretAccessKey: s3Credentials.secretAccessKey,
    targetGroupArn,
    albRulePriority: priority,
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
  });

  // Create DNS record pointing to ALB
  await route53Manager.createUserDNSRecord(
    sanitizedUsername,
    process.env.ALB_DNS_NAME!,
    process.env.ALB_ZONE_ID!
  );

  return {
    message: "Instance created successfully",
    userId,
    status: "created",
    accessPointId,
    targetGroupArn,
    url: route53Manager.getUserFoundryUrl(sanitizedUsername),
    adminKey,
    s3BucketName,
    s3BucketUrl: s3Manager.getBucketUrl(s3BucketName),
  };
}

async function startInstance(userId: string) {
  const instance = await dynamoManager.getInstance(userId);
  if (!instance || !instance.targetGroupArn) {
    throw new Error("Instance not found or missing target group");
  }

  if (instance.status === "running") {
    throw new Error("Instance is already running");
  }

  // Register task definition and start task
  const taskDefinitionArn = await ecsManager.registerTaskDefinition(
    userId,
    instance.sanitizedUsername,
    instance.accessPointId,
    instance.secretArn,
    instance.s3BucketName,
    instance.s3AccessKeyId,
    instance.s3SecretAccessKey,
    instance.foundryVersion
  );

  const taskArn = await ecsManager.runTask(
    taskDefinitionArn,
    process.env.PRIVATE_SUBNET_IDS!.split(","),
    [process.env.TASK_SECURITY_GROUP_ID!]
  );

  // Wait for task to be running
  await taskManager.waitForTaskRunning(taskArn);

  // Get task private IP
  const taskPrivateIp = await taskManager.getTaskPrivateIp(taskArn);

  // Register task with ALB target group
  await albManager.registerTaskWithTargetGroup(
    instance.targetGroupArn,
    taskPrivateIp
  );

  // Create ALB listener rule
  const ruleArn = await albManager.createListenerRule(
    instance.sanitizedUsername,
    instance.targetGroupArn,
    instance.albRulePriority!
  );

  // Update instance status
  await dynamoManager.updateInstance(userId, {
    status: "running",
    taskArn,
    taskDefinitionArn,
    taskPrivateIp,
    albRuleArn: ruleArn,
    updatedAt: Math.floor(Date.now() / 1000),
  });

  return {
    message: "Instance is running",
    userId,
    status: "running",
    taskArn,
    url: route53Manager.getUserFoundryUrl(instance.sanitizedUsername),
  };
}

async function stopInstance(userId: string) {
  const instance = await dynamoManager.getInstance(userId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  // Deregister from ALB first
  if (instance.taskPrivateIp && instance.targetGroupArn) {
    await albManager.deregisterTaskFromTargetGroup(
      instance.targetGroupArn,
      instance.taskPrivateIp
    );
  }

  // Delete ALB listener rule
  if (instance.albRuleArn) {
    await albManager.deleteListenerRule(instance.albRuleArn);
  }

  // Stop ECS task
  if (instance.taskArn) {
    await ecsManager.stopTask(instance.taskArn);
  }

  await dynamoManager.updateInstance(userId, {
    status: "stopped",
    taskArn: undefined,
    taskPrivateIp: undefined,
    albRuleArn: undefined,
    updatedAt: Math.floor(Date.now() / 1000),
  });

  return {
    message: "Instance is stopped",
    userId,
    status: "stopped",
  };
}

async function destroyInstance(userId: string) {
  const instance = await dynamoManager.getInstance(userId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  // Stop task and clean up ALB first
  if (instance.taskArn) {
    await stopInstance(userId); // This handles ALB cleanup
  }

  // Delete ALB target group
  if (instance.targetGroupArn) {
    await albManager.deleteUserTargetGroup(instance.targetGroupArn);
  }

  // Delete DNS record
  await route53Manager.deleteUserDNSRecord(
    instance.sanitizedUsername,
    process.env.ALB_DNS_NAME!,
    process.env.ALB_ZONE_ID!
  );

  // Clean up EFS files and delete access point
  if (instance.accessPointId) {
    await efsManager.cleanupAndDeleteAccessPoint(
      instance.accessPointId,
      userId,
      ecsManager
    );
  }

  // Delete S3 bucket
  if (instance.s3BucketName) {
    await s3Manager.deleteFoundryBucket(instance.s3BucketName);
  }

  // Delete IAM user
  if (instance.s3AccessKeyId) {
    await iamManager.deleteFoundryUser(userId, instance.sanitizedUsername);
  }

  // Delete secrets
  if (instance.secretArn) {
    await secretsManager.deleteSecret(instance.secretArn);
  }

  // Delete instance record
  await dynamoManager.deleteInstance(userId);

  return {
    message: "Instance destroyed successfully",
    userId,
  };
}

async function deleteUser(userId: string) {
  const instance = await dynamoManager.getInstance(userId);

  // If user has an active instance, destroy it first
  if (instance) {
    console.log(`User ${userId} has active instance, destroying it first`);
    await destroyInstance(userId);
  }

  // Clean up any remaining secrets that might exist
  try {
    const existingCredentials = await secretsManager.getCredentials(userId);
    if (existingCredentials) {
      // Delete the secret using the user-based secret name pattern
      const secretName = `foundry-credentials-${userId}`;
      await secretsManager.deleteSecret(secretName);
      console.log(`Deleted remaining credentials for user: ${userId}`);
    }
  } catch (error) {
    // Secret doesn't exist or already deleted, continue
    console.log(`No existing credentials found for user: ${userId}`);
  }

  // Note: DNS cleanup is handled in destroyInstance if instance exists
  // For orphaned DNS records, we would need the sanitized username
  // which we don't have if there's no instance record
  console.log(`DNS cleanup handled via destroyInstance for user: ${userId}`);

  return {
    message: "User deleted successfully",
    userId,
    note: "All user data, credentials, and infrastructure have been permanently removed",
  };
}

async function getInstanceStatus(userId: string) {
  const instance = await dynamoManager.getInstance(userId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  // Get real status from ECS if we have a task ARN
  if (instance.taskArn) {
    const taskStatus = await ecsManager.getTaskStatus(instance.taskArn);
    if (taskStatus) {
      await dynamoManager.updateInstance(userId, { status: taskStatus });
      instance.status = taskStatus;
    }
  }

  return {
    userId,
    status: instance.status,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    url: route53Manager.getUserFoundryUrl(instance.sanitizedUsername),
    adminKey: instance.adminKey,
    foundryVersion: instance.foundryVersion || "13",
    s3BucketName: instance.s3BucketName,
    s3BucketUrl: instance.s3BucketName
      ? s3Manager.getBucketUrl(instance.s3BucketName)
      : undefined,
  };
}

async function getAllInstances() {
  const instances = await dynamoManager.getAllInstances();

  return {
    instances: instances.map((instance) => ({
      userId: instance.userId,
      sanitizedUsername: instance.sanitizedUsername,
      status: instance.status,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      url: route53Manager.getUserFoundryUrl(instance.sanitizedUsername),
      adminKey: instance.adminKey,
      foundryVersion: instance.foundryVersion || "13",
      s3BucketName: instance.s3BucketName,
      s3BucketUrl: instance.s3BucketName
        ? s3Manager.getBucketUrl(instance.s3BucketName)
        : undefined,
    })),
    count: instances.length,
  };
}

async function updateInstanceVersion(userId: string, foundryVersion: string) {
  const instance = await dynamoManager.getInstance(userId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  // Validate version format (basic validation)
  const validVersions = ["13", "12", "11", "release", "latest"];
  const versionRegex = /^\d+\.\d+(\.\d+)?$/; // Matches x.y or x.y.z format

  if (
    !validVersions.includes(foundryVersion) &&
    !versionRegex.test(foundryVersion)
  ) {
    throw new Error("Invalid version format");
  }

  // Check if permission reset is needed for version compatibility
  const currentVersion = instance.foundryVersion || "13";
  const needsPermissionReset =
    (foundryVersion.startsWith("11") || foundryVersion.startsWith("12")) &&
    !(currentVersion.startsWith("11") || currentVersion.startsWith("12"));

  if (needsPermissionReset) {
    console.log(
      `Permission reset needed: switching from v${currentVersion} to v${foundryVersion}`
    );
    try {
      await efsManager.resetPermissionsForVersionSwitch(
        instance.accessPointId,
        userId,
        ecsManager,
        foundryVersion
      );
      console.log(`✅ Permissions reset completed for version switch`);
    } catch (error) {
      console.error(`Failed to reset permissions:`, error);
      // Continue with version update even if permission reset fails
      // User can manually recreate instance if needed
    }
  }

  // Update the instance record with the new version
  await dynamoManager.updateInstance(userId, {
    foundryVersion,
    updatedAt: Math.floor(Date.now() / 1000),
  });

  return {
    message: "Version updated successfully",
    userId,
    foundryVersion,
    note: "Restart your instance to use the new version",
  };
}

function generateAdminKey(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

function successResponse(data: any): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

function errorResponse(
  statusCode: number,
  message: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: message }),
  };
}

// lambda/src/utils/ecs-manager.ts

// lambda/src/utils/efs-manager.ts

// lambda/src/utils/secrets-manager.ts
