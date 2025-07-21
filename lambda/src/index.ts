import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { ECSManager } from "./utils/ecs-manager";
import { EFSManager } from "./utils/efs-manager";
import { SecretsManager } from "./utils/secrets-manager";
import {
  DynamoDBManager,
  ScheduledSession,
  LicensePool,
} from "./utils/dynamodb-manager";
import { ALBManager } from "./utils/alb-manager";
import { Route53Manager } from "./utils/route53-manager";
import { TaskManager } from "./utils/task-manager";
import { S3Manager } from "./utils/s3-manager";
import { IAMManager } from "./utils/iam-manager";
import { LicenseScheduler } from "./utils/license-scheduler";
import { AutoShutdownManager } from "./utils/auto-shutdown-manager";

interface FoundryEvent {
  action:
    | "create"
    | "start"
    | "stop"
    | "destroy"
    | "delete"
    | "status"
    | "list-all"
    | "update-version"
    | "schedule-session"
    | "cancel-session"
    | "list-sessions"
    | "set-license-sharing"
    | "check-availability"
    | "start-scheduled-session"
    | "end-scheduled-session"
    | "auto-shutdown-check"
    | "prepare-sessions"
    | "shutdown-stats"
    | "admin-overview"
    | "admin-force-shutdown"
    | "admin-cancel-session"
    | "admin-cancel-all-sessions"
    | "admin-system-maintenance";
  userId: string;
  sanitizedUsername?: string;
  foundryUsername?: string;
  foundryPassword?: string;
  foundryVersion?: string;
  // License management fields
  licenseType?: "byol" | "pooled";
  allowLicenseSharing?: boolean;
  maxConcurrentUsers?: number;
  // Scheduling fields
  sessionId?: string;
  startTime?: number;
  endTime?: number;
  sessionTitle?: string;
  sessionDescription?: string;
  preferredLicenseId?: string;
  // Admin fields
  targetUserId?: string;
  forceReason?: string;
  // Pooled license field
  selectedLicenseId?: string;
  // Destroy options
  keepLicenseSharing?: boolean;
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
const licenseScheduler = new LicenseScheduler(
  dynamoManager,
  ecsManager,
  secretsManager
);
const autoShutdownManager = new AutoShutdownManager(
  dynamoManager,
  ecsManager,
  albManager,
  licenseScheduler
);

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
        result = await destroyInstance(userId, event);
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
      case "schedule-session":
        result = await scheduleSession(userId, event);
        break;
      case "cancel-session":
        result = await cancelSession(event.sessionId!);
        break;
      case "list-sessions":
        result = await listUserSessions(userId);
        break;
      case "set-license-sharing":
        result = await setLicenseSharing(userId, event);
        break;
      case "check-availability":
        result = await checkLicenseAvailability(event);
        break;
      case "start-scheduled-session":
        result = await startScheduledSession(event.sessionId!);
        break;
      case "end-scheduled-session":
        result = await endScheduledSession(event.sessionId!);
        break;
      case "auto-shutdown-check":
        result = await performAutoShutdownCheck();
        break;
      case "prepare-sessions":
        result = await prepareUpcomingSessions();
        break;
      case "shutdown-stats":
        result = await getShutdownStats();
        break;
      case "admin-overview":
        result = await getAdminOverview();
        break;
      case "admin-force-shutdown":
        result = await adminForceShutdown(
          event.targetUserId!,
          event.forceReason
        );
        break;
      case "admin-cancel-session":
        result = await adminCancelSession(event.sessionId!, event.forceReason);
        break;
      case "admin-cancel-all-sessions":
        result = await adminCancelAllSessions(event.forceReason);
        break;
      case "admin-system-maintenance":
        result = await adminSystemMaintenance(event.forceReason);
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

  const {
    foundryUsername,
    foundryPassword,
    sanitizedUsername,
    licenseType,
    allowLicenseSharing,
    maxConcurrentUsers,
    selectedLicenseId,
  } = event;

  let actualFoundryUsername: string;
  let actualFoundryPassword: string;

  // Validate license type
  const validatedLicenseType = licenseType || "byol";
  if (!["byol", "pooled"].includes(validatedLicenseType)) {
    throw new Error("Invalid license type. Must be 'byol' or 'pooled'");
  }

  if (validatedLicenseType === "pooled") {
    // For pooled licenses, we handle two cases:
    // 1. selectedLicenseId provided (specific license chosen)
    // 2. No selectedLicenseId (automatic assignment at runtime)

    if (selectedLicenseId) {
      // Case 1: Specific license selected (e.g. user's own license in pooled mode)
      // Extract owner ID from license ID (format: "byol-{ownerId}")
      const ownerIdMatch = selectedLicenseId.match(/^byol-(.+)$/);
      if (!ownerIdMatch) {
        throw new Error("Invalid license ID format");
      }

      const ownerId = ownerIdMatch[1];

      // Get the license owner's credentials
      try {
        const ownerCredentials = await secretsManager.getCredentials(ownerId);
        if (!ownerCredentials) {
          throw new Error(
            "License owner credentials not found - the license owner may have deleted their instance"
          );
        }

        actualFoundryUsername = ownerCredentials.username;
        actualFoundryPassword = ownerCredentials.password;
      } catch (error) {
        // If credentials not found, also check if we should deactivate the license pool
        const licensePool = await dynamoManager.getLicensePool(
          selectedLicenseId
        );
        if (licensePool && licensePool.isActive) {
          try {
            await dynamoManager.updateLicensePool(selectedLicenseId, {
              isActive: false,
              updatedAt: Math.floor(Date.now() / 1000),
            });
            console.log(
              `Auto-deactivated license pool with missing credentials: ${selectedLicenseId}`
            );
          } catch (poolError) {
            console.error(`Failed to auto-deactivate license pool:`, poolError);
          }
        }

        throw new Error(
          `Failed to get license owner credentials: ${
            error instanceof Error ? error.message : "Unknown error"
          }. The license pool has been automatically deactivated.`
        );
      }
    } else {
      // Case 2: No specific license - will be assigned at start/schedule time
      // For now, we don't store any credentials. They'll be obtained when starting instance.
      actualFoundryUsername = "POOLED_DYNAMIC"; // Placeholder
      actualFoundryPassword = "POOLED_DYNAMIC"; // Placeholder
      console.log(
        `Creating pooled instance with dynamic license assignment for user: ${userId}`
      );
    }
  } else {
    // For BYOL, use provided credentials or reuse existing ones
    if (!foundryUsername || !foundryPassword) {
      // Try to reuse existing credentials for re-registration
      try {
        const existingCredentials = await secretsManager.getCredentials(userId);
        if (!existingCredentials) {
          throw new Error("Missing Foundry credentials for BYOL license");
        }

        actualFoundryUsername = existingCredentials.username;
        actualFoundryPassword = existingCredentials.password;
        console.log(
          `Reusing existing credentials for BYOL re-registration: ${userId}`
        );
      } catch (error) {
        throw new Error("Missing Foundry credentials for BYOL license");
      }
    } else {
      actualFoundryUsername = foundryUsername;
      actualFoundryPassword = foundryPassword;
    }
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
    actualFoundryUsername,
    actualFoundryPassword,
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
    licenseType: validatedLicenseType,
    allowLicenseSharing: allowLicenseSharing,
    maxConcurrentUsers: maxConcurrentUsers || 1,
    licenseOwnerId:
      validatedLicenseType === "pooled" ? selectedLicenseId : undefined,
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
  });

  // If user is sharing their license, add to license pool or reactivate existing one
  if (validatedLicenseType === "byol" && allowLicenseSharing) {
    const licenseId = `byol-${userId}`;

    // Check if there's already a license pool (might be deactivated)
    const existingPool = await dynamoManager.getLicensePool(licenseId);

    if (existingPool) {
      // Reactivate existing pool with updated settings
      await dynamoManager.updateLicensePool(licenseId, {
        ownerUsername: sanitizedUsername, // Update in case username changed
        maxConcurrentUsers: maxConcurrentUsers || 1,
        isActive: true,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      console.log(`Reactivated existing license pool: ${licenseId}`);
    } else {
      // Create new license pool
      await dynamoManager.createLicensePool({
        licenseId,
        ownerId: userId,
        ownerUsername: sanitizedUsername,
        maxConcurrentUsers: maxConcurrentUsers || 1,
        isActive: true,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });
      console.log(`Created new license pool: ${licenseId}`);
    }
  }

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

  // For BYOL users, check if starting on-demand would conflict with scheduled sessions
  if (instance.licenseType === "byol") {
    const canStart = await licenseScheduler.canStartOnDemandInstance(userId);
    if (!canStart.canStart) {
      throw new Error(
        canStart.reason ||
          "Cannot start on-demand instance due to scheduling conflicts"
      );
    }
  } else if (instance.licenseType === "pooled") {
    throw new Error(
      "Pooled license users must schedule sessions - use 'Schedule Session' instead of on-demand start"
    );
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

  const now = Math.floor(Date.now() / 1000);

  // Calculate auto-shutdown time
  const licenseType = instance.licenseType || "byol";
  const autoShutdownAt = autoShutdownManager.calculateAutoShutdownTime(
    now,
    licenseType,
    instance.linkedSessionId
  );

  // Update instance status
  await dynamoManager.updateInstance(userId, {
    status: "running",
    taskArn,
    taskDefinitionArn,
    taskPrivateIp,
    albRuleArn: ruleArn,
    startedAt: now,
    autoShutdownAt,
    updatedAt: now,
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
    autoShutdownAt: undefined,
    startedAt: undefined,
    linkedSessionId: undefined,
    updatedAt: Math.floor(Date.now() / 1000),
  });

  return {
    message: "Instance is stopped",
    userId,
    status: "stopped",
  };
}

async function destroyInstance(userId: string, event?: FoundryEvent) {
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

  // Conditionally deactivate license pools based on user choice
  if (instance.allowLicenseSharing && !event?.keepLicenseSharing) {
    const licenseId = `byol-${userId}`;
    try {
      await dynamoManager.updateLicensePool(licenseId, {
        isActive: false,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      console.log(
        `Deactivated license pool for destroyed instance: ${licenseId}`
      );
    } catch (error) {
      console.error(`Failed to deactivate license pool ${licenseId}:`, error);
      // Continue with instance deletion even if license pool deactivation fails
    }
  } else if (instance.allowLicenseSharing && event?.keepLicenseSharing) {
    console.log(
      `License sharing preserved for destroyed instance: byol-${userId} (user choice: keep sharing active)`
    );
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

  // Deactivate any license pools owned by this user since credentials are being deleted
  const licenseId = `byol-${userId}`;
  try {
    const existingPool = await dynamoManager.getLicensePool(licenseId);
    if (existingPool && existingPool.isActive) {
      await dynamoManager.updateLicensePool(licenseId, {
        isActive: false,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      console.log(
        `Deactivated orphaned license pool for deleted user: ${licenseId}`
      );
    }
  } catch (error) {
    console.error(`Failed to deactivate license pool ${licenseId}:`, error);
    // Continue with user deletion even if license pool deactivation fails
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

  // Get upcoming scheduled sessions for this user
  let nextScheduledSession = null;
  try {
    const userSessions = await dynamoManager.getUserScheduledSessions(userId);
    const now = Math.floor(Date.now() / 1000);
    const upcomingSessions = userSessions
      .filter(
        (session) => session.status === "scheduled" && session.startTime > now
      )
      .sort((a, b) => a.startTime - b.startTime);

    if (upcomingSessions.length > 0) {
      nextScheduledSession = upcomingSessions[0];
    }
  } catch (error) {
    console.error("Error getting scheduled sessions:", error);
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
    licenseType: instance.licenseType,
    allowLicenseSharing: instance.allowLicenseSharing,
    autoShutdownAt: instance.autoShutdownAt,
    linkedSessionId: instance.linkedSessionId,
    nextScheduledSession,
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

async function scheduleSession(userId: string, event: FoundryEvent) {
  if (!event.startTime || !event.endTime || !event.licenseType) {
    throw new Error("Missing required fields: startTime, endTime, licenseType");
  }

  const instance = await dynamoManager.getInstance(userId);
  if (!instance) {
    throw new Error("User must have an instance to schedule sessions");
  }

  const result = await licenseScheduler.scheduleSession({
    userId,
    username: instance.sanitizedUsername,
    startTime: event.startTime,
    endTime: event.endTime,
    licenseType: event.licenseType,
    title: event.sessionTitle,
    description: event.sessionDescription,
    preferredLicenseId: event.preferredLicenseId,
  });

  return {
    message: result.message,
    success: result.success,
    sessionId: result.sessionId,
    conflictsResolved: result.conflictsResolved,
  };
}

async function cancelSession(sessionId: string) {
  const session = await dynamoManager.getScheduledSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  await dynamoManager.updateScheduledSession(sessionId, {
    status: "cancelled",
    updatedAt: Math.floor(Date.now() / 1000),
  });

  return {
    message: "Session cancelled successfully",
    sessionId,
  };
}

async function listUserSessions(userId: string) {
  const sessions = await dynamoManager.getUserScheduledSessions(userId);
  return {
    sessions,
    count: sessions.length,
  };
}

async function setLicenseSharing(userId: string, event: FoundryEvent) {
  const instance = await dynamoManager.getInstance(userId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  // Default to BYOL if not specified
  const licenseType = event.licenseType || "byol";

  await dynamoManager.updateInstance(userId, {
    licenseType,
    allowLicenseSharing: event.allowLicenseSharing,
    maxConcurrentUsers: event.maxConcurrentUsers,
    updatedAt: Math.floor(Date.now() / 1000),
  });

  // If user is sharing their license, add to license pool or reactivate existing one
  if (licenseType === "byol" && event.allowLicenseSharing) {
    const licenseId = `byol-${userId}`;

    // Check if there's already a license pool (might be deactivated)
    const existingPool = await dynamoManager.getLicensePool(licenseId);

    if (existingPool) {
      // Reactivate or update existing pool
      await dynamoManager.updateLicensePool(licenseId, {
        ownerUsername: instance.sanitizedUsername,
        maxConcurrentUsers: event.maxConcurrentUsers || 1,
        isActive: true,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      console.log(`Reactivated existing license pool: ${licenseId}`);
    } else {
      // Create new license pool
      await dynamoManager.createLicensePool({
        licenseId,
        ownerId: userId,
        ownerUsername: instance.sanitizedUsername,
        maxConcurrentUsers: event.maxConcurrentUsers || 1,
        isActive: true,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      });
      console.log(`Created new license pool: ${licenseId}`);
    }
  } else if (licenseType === "byol" && !event.allowLicenseSharing) {
    // If user is turning off license sharing, deactivate their pool
    const licenseId = `byol-${userId}`;
    try {
      const existingPool = await dynamoManager.getLicensePool(licenseId);
      if (existingPool && existingPool.isActive) {
        await dynamoManager.updateLicensePool(licenseId, {
          isActive: false,
          updatedAt: Math.floor(Date.now() / 1000),
        });
        console.log(`Deactivated license pool: ${licenseId}`);
      }
    } catch (error) {
      console.error(`Failed to deactivate license pool ${licenseId}:`, error);
    }
  }

  return {
    message: "License sharing settings updated",
    licenseType,
    allowLicenseSharing: event.allowLicenseSharing,
    maxConcurrentUsers: event.maxConcurrentUsers,
  };
}

async function checkLicenseAvailability(event: FoundryEvent) {
  if (!event.startTime || !event.endTime || !event.licenseType) {
    throw new Error("Missing required fields: startTime, endTime, licenseType");
  }

  const availability = await licenseScheduler.checkLicenseAvailability(
    event.licenseType,
    event.startTime,
    event.endTime,
    event.preferredLicenseId
  );

  return {
    available: availability.available,
    conflictingInstances: availability.conflictingInstances,
    conflictingSessions: availability.conflictingSessions,
    availableLicenses: availability.availableLicenses,
  };
}

async function startScheduledSession(sessionId: string) {
  const result = await licenseScheduler.startScheduledSession(sessionId);
  return result;
}

async function endScheduledSession(sessionId: string) {
  const result = await licenseScheduler.endScheduledSession(sessionId);
  return result;
}

async function performAutoShutdownCheck() {
  const result = await autoShutdownManager.checkAndShutdownExpiredInstances();
  return {
    message: `Auto-shutdown check completed. ${result.shutdownCount} instances shut down.`,
    shutdownCount: result.shutdownCount,
    results: result.results,
  };
}

async function prepareUpcomingSessions() {
  const result = await autoShutdownManager.prepareForUpcomingSessions();
  return {
    message: `Prepared ${result.sessionsStarted} sessions, resolved ${result.conflictsResolved} conflicts`,
    sessionsStarted: result.sessionsStarted,
    conflictsResolved: result.conflictsResolved,
  };
}

async function getShutdownStats() {
  const stats = await autoShutdownManager.getAutoShutdownStats();
  return {
    message: "Auto-shutdown statistics",
    stats,
  };
}

async function getAdminOverview() {
  const now = Math.floor(Date.now() / 1000);

  // Get all instances
  const allInstances = await dynamoManager.getAllInstances();

  // Get all sessions in a wide time range to find active ones
  const allRecentSessions = await dynamoManager.getSessionsInTimeRange(
    now - 24 * 60 * 60, // Last 24 hours
    now + 24 * 60 * 60 // Next 24 hours
  );

  // Filter active sessions
  const activeSessions = allRecentSessions.filter((s) => s.status === "active");

  // Get upcoming sessions (next 24 hours)
  const upcomingSessions = allRecentSessions.filter(
    (s) => s.status === "scheduled" && s.startTime > now
  );

  // Get license pools
  const licensePools = await dynamoManager.getAllActiveLicenses();

  // Get auto-shutdown stats
  const shutdownStats = await autoShutdownManager.getAutoShutdownStats();

  // Calculate summary statistics
  const runningInstances = allInstances.filter((i) => i.status === "running");
  const byolInstances = allInstances.filter((i) => i.licenseType === "byol");
  const pooledInstances = allInstances.filter(
    (i) => i.licenseType === "pooled"
  );
  const sharedLicenses = allInstances.filter((i) => i.allowLicenseSharing);

  // Get instances with auto-shutdown timers
  const instancesWithTimers = runningInstances.filter((i) => i.autoShutdownAt);

  // Recent activity (last 2 hours)
  const recentThreshold = now - 2 * 60 * 60;
  const recentlyStarted = allInstances.filter(
    (i) => i.startedAt && i.startedAt > recentThreshold
  );
  const recentlyUpdated = allInstances.filter(
    (i) => i.updatedAt > recentThreshold
  );

  return {
    timestamp: now,
    summary: {
      totalInstances: allInstances.length,
      runningInstances: runningInstances.length,
      byolInstances: byolInstances.length,
      pooledInstances: pooledInstances.length,
      sharedLicenses: sharedLicenses.length,
      activeSessions: activeSessions.length,
      upcomingSessions: upcomingSessions.length,
      instancesWithTimers: instancesWithTimers.length,
    },
    instances: {
      running: runningInstances.map((i) => ({
        userId: i.userId,
        username: i.sanitizedUsername,
        status: i.status,
        licenseType: i.licenseType,
        startedAt: i.startedAt,
        autoShutdownAt: i.autoShutdownAt,
        linkedSessionId: i.linkedSessionId,
        foundryVersion: i.foundryVersion,
      })),
      stopped: allInstances
        .filter((i) => i.status === "stopped")
        .map((i) => ({
          userId: i.userId,
          username: i.sanitizedUsername,
          licenseType: i.licenseType,
          updatedAt: i.updatedAt,
        })),
    },
    sessions: {
      active: activeSessions.map((s) => ({
        sessionId: s.sessionId,
        userId: s.userId,
        username: s.username,
        title: s.title,
        startTime: s.startTime,
        endTime: s.endTime,
        licenseType: s.licenseType,
        licenseId: s.licenseId,
      })),
      upcoming: upcomingSessions.map((s: ScheduledSession) => ({
        sessionId: s.sessionId,
        userId: s.userId,
        username: s.username,
        title: s.title,
        startTime: s.startTime,
        endTime: s.endTime,
        licenseType: s.licenseType,
        licenseId: s.licenseId,
      })),
    },
    licenses: {
      pools: licensePools.map((l: LicensePool) => ({
        licenseId: l.licenseId,
        ownerId: l.ownerId,
        ownerUsername: l.ownerUsername,
        maxConcurrentUsers: l.maxConcurrentUsers,
        isActive: l.isActive,
      })),
    },
    activity: {
      recentlyStarted: recentlyStarted.map((i) => ({
        userId: i.userId,
        username: i.sanitizedUsername,
        startedAt: i.startedAt,
      })),
      recentlyUpdated: recentlyUpdated.map((i) => ({
        userId: i.userId,
        username: i.sanitizedUsername,
        updatedAt: i.updatedAt,
        status: i.status,
      })),
    },
    autoShutdown: shutdownStats,
  };
}

async function adminForceShutdown(targetUserId: string, reason?: string) {
  const instance = await dynamoManager.getInstance(targetUserId);
  if (!instance) {
    throw new Error("Target user instance not found");
  }

  if (instance.status !== "running") {
    throw new Error("Instance is not running");
  }

  console.log(
    `Admin force shutdown: ${targetUserId}, reason: ${
      reason || "No reason provided"
    }`
  );

  // Use the existing stop instance logic
  await stopInstance(targetUserId);

  // Log the admin action
  const logMessage = `Admin force shutdown - User: ${
    instance.sanitizedUsername
  }, Reason: ${reason || "No reason provided"}`;
  console.log(logMessage);

  return {
    message: "Instance force shutdown completed",
    targetUserId,
    targetUsername: instance.sanitizedUsername,
    reason: reason || "No reason provided",
    timestamp: Math.floor(Date.now() / 1000),
  };
}

async function adminCancelSession(sessionId: string, reason?: string) {
  const session = await dynamoManager.getScheduledSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  if (session.status === "cancelled") {
    throw new Error("Session is already cancelled");
  }

  console.log(
    `Admin cancel session: ${sessionId}, reason: ${
      reason || "No reason provided"
    }`
  );

  // If session is active, also stop the related instance
  if (session.status === "active" && session.instanceId) {
    try {
      await stopInstance(session.instanceId);
      console.log(
        `Stopped instance ${session.instanceId} for cancelled session`
      );
    } catch (error) {
      console.error(`Failed to stop instance for cancelled session:`, error);
    }
  }

  // Cancel the session
  await dynamoManager.updateScheduledSession(sessionId, {
    status: "cancelled",
    updatedAt: Math.floor(Date.now() / 1000),
  });

  // Log the admin action
  const logMessage = `Admin cancel session - Session: ${sessionId}, User: ${
    session.username
  }, Reason: ${reason || "No reason provided"}`;
  console.log(logMessage);

  return {
    message: "Session cancelled successfully",
    sessionId,
    userId: session.userId,
    username: session.username,
    reason: reason || "No reason provided",
    timestamp: Math.floor(Date.now() / 1000),
  };
}

async function adminCancelAllSessions(reason?: string) {
  console.log(
    `Admin cancel all sessions, reason: ${reason || "No reason provided"}`
  );

  // Get all active and scheduled sessions
  const now = Math.floor(Date.now() / 1000);
  const allSessions = await dynamoManager.getSessionsInTimeRange(
    now - 24 * 60 * 60, // Last 24 hours for active sessions
    now + 7 * 24 * 60 * 60 // Next 7 days for scheduled sessions
  );

  const sessionsToCancel = allSessions.filter(
    (s) => s.status === "active" || s.status === "scheduled"
  );

  if (sessionsToCancel.length === 0) {
    return {
      message: "No active or scheduled sessions to cancel",
      cancelledCount: 0,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  let cancelledCount = 0;
  const errors = [];

  for (const session of sessionsToCancel) {
    try {
      // If session is active, also stop the related instance
      if (session.status === "active" && session.instanceId) {
        try {
          await stopInstance(session.instanceId);
          console.log(
            `Stopped instance ${session.instanceId} for cancelled session ${session.sessionId}`
          );
        } catch (error) {
          console.error(
            `Failed to stop instance for session ${session.sessionId}:`,
            error
          );
        }
      }

      // Cancel the session
      await dynamoManager.updateScheduledSession(session.sessionId, {
        status: "cancelled",
        updatedAt: now,
      });

      cancelledCount++;
    } catch (error) {
      errors.push(
        `${session.sessionId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  // Log the admin action
  const logMessage = `Admin cancel all sessions - ${cancelledCount} sessions cancelled, Reason: ${
    reason || "No reason provided"
  }`;
  console.log(logMessage);

  return {
    message: `Cancelled ${cancelledCount}/${sessionsToCancel.length} sessions`,
    cancelledCount,
    totalSessions: sessionsToCancel.length,
    errors: errors.length > 0 ? errors : undefined,
    reason: reason || "No reason provided",
    timestamp: now,
  };
}

async function adminSystemMaintenance(reason?: string) {
  console.log(
    `Admin system maintenance mode, reason: ${reason || "No reason provided"}`
  );

  const now = Math.floor(Date.now() / 1000);

  // Get all running instances and active sessions
  const allInstances = await dynamoManager.getAllInstances();
  const runningInstances = allInstances.filter((i) => i.status === "running");

  const allSessions = await dynamoManager.getSessionsInTimeRange(
    now - 24 * 60 * 60,
    now + 7 * 24 * 60 * 60
  );
  const activeSessions = allSessions.filter(
    (s) => s.status === "active" || s.status === "scheduled"
  );

  let shutdownCount = 0;
  let cancelledCount = 0;
  const errors = [];

  // Cancel all sessions first
  for (const session of activeSessions) {
    try {
      await dynamoManager.updateScheduledSession(session.sessionId, {
        status: "cancelled",
        updatedAt: now,
      });
      cancelledCount++;
    } catch (error) {
      errors.push(
        `Session ${session.sessionId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  // Then shutdown all instances
  for (const instance of runningInstances) {
    try {
      await stopInstance(instance.userId);
      shutdownCount++;
    } catch (error) {
      errors.push(
        `Instance ${instance.sanitizedUsername}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  // Log the admin action
  const logMessage = `Admin system maintenance - ${shutdownCount} instances shutdown, ${cancelledCount} sessions cancelled, Reason: ${
    reason || "No reason provided"
  }`;
  console.log(logMessage);

  return {
    message: "System maintenance mode activated",
    shutdownCount,
    cancelledCount,
    totalInstances: runningInstances.length,
    totalSessions: activeSessions.length,
    errors: errors.length > 0 ? errors : undefined,
    reason: reason || "No reason provided",
    timestamp: now,
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
