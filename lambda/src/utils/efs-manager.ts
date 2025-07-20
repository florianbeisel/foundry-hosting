import {
  EFSClient,
  CreateAccessPointCommand,
  DeleteAccessPointCommand,
  DescribeAccessPointsCommand,
} from "@aws-sdk/client-efs";
import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";

export class EFSManager {
  private efs: EFSClient;
  private ecs: ECSClient;
  private fileSystemId: string;

  constructor(fileSystemId: string) {
    this.efs = new EFSClient({ region: process.env.AWS_REGION || "us-east-1" });
    this.ecs = new ECSClient({ region: process.env.AWS_REGION || "us-east-1" });
    this.fileSystemId = fileSystemId;
  }

  async createAccessPoint(userId: string): Promise<string> {
    const command = new CreateAccessPointCommand({
      FileSystemId: this.fileSystemId,
      PosixUser: {
        Uid: 1000, // felddy/foundryvtt v13 default
        Gid: 1000,
      },
      RootDirectory: {
        Path: `/foundry-instances/${userId}`,
        CreationInfo: {
          OwnerUid: 1000,
          OwnerGid: 1000,
          Permissions: "755",
        },
      },
      Tags: [
        {
          Key: "Name",
          Value: `foundry-${userId}`,
        },
        {
          Key: "UserId",
          Value: userId,
        },
      ],
    });

    const response = await this.efs.send(command);
    const accessPointId = response.AccessPointId!;

    // Wait for access point to be available
    await this.waitForAccessPoint(accessPointId);

    return accessPointId;
  }

  async resetPermissionsForVersionSwitch(
    accessPointId: string,
    userId: string,
    ecsManager: {
      registerPermissionResetTaskDefinition: (
        uid: number,
        gid: number
      ) => Promise<string>;
    },
    targetVersion: string
  ): Promise<void> {
    console.log(
      `Resetting permissions for version switch to ${targetVersion} for user: ${userId}`
    );

    // Determine the correct UID/GID for the target version
    let targetUid = 1000;
    let targetGid = 1000;

    if (targetVersion.startsWith("11") || targetVersion.startsWith("12")) {
      // v11 and v12 use different user ID (421:421)
      targetUid = 421;
      targetGid = 421;
    }
    // v13+ uses 1000:1000 (default)

    console.log(
      `Setting ownership to ${targetUid}:${targetGid} for version ${targetVersion}`
    );

    // Run permission reset task (reuses cleanup infrastructure)
    await this.runCleanupTask(userId, {
      registerCleanupTaskDefinition: () =>
        ecsManager.registerPermissionResetTaskDefinition(targetUid, targetGid),
    });

    console.log(`✅ Permission reset completed for user: ${userId}`);
  }

  async cleanupAndDeleteAccessPoint(
    accessPointId: string,
    userId: string,
    ecsManager: { registerCleanupTaskDefinition: () => Promise<string> }
  ): Promise<void> {
    console.log(`Cleaning up EFS files for user: ${userId}`);

    try {
      // Run cleanup task to delete user's files before removing access point
      await this.runCleanupTask(userId, ecsManager);
      console.log(`✅ EFS files cleaned up for user: ${userId}`);
    } catch (error) {
      console.error(`Failed to cleanup EFS files for user ${userId}:`, error);
      // Continue with access point deletion even if cleanup fails
    }

    // Delete the access point
    await this.deleteAccessPoint(accessPointId);
  }

  async deleteAccessPoint(accessPointId: string): Promise<void> {
    const command = new DeleteAccessPointCommand({
      AccessPointId: accessPointId,
    });

    await this.efs.send(command);
  }

  async runCleanupTask(
    userId: string,
    ecsManager: { registerCleanupTaskDefinition: () => Promise<string> }
  ): Promise<void> {
    console.log(`Running EFS cleanup task for user: ${userId}`);

    // Register cleanup task definition
    const cleanupTaskDefinition =
      await ecsManager.registerCleanupTaskDefinition();

    const runTaskCommand = new RunTaskCommand({
      cluster: process.env.CLUSTER_NAME!,
      taskDefinition: cleanupTaskDefinition,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: process.env.PRIVATE_SUBNET_IDS!.split(","),
          securityGroups: [process.env.TASK_SECURITY_GROUP_ID!],
          assignPublicIp: "DISABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "cleanup",
            environment: [
              {
                name: "USER_ID",
                value: userId,
              },
            ],
          },
        ],
      },
    });

    const runTaskResponse = await this.ecs.send(runTaskCommand);
    const taskArn = runTaskResponse.tasks![0].taskArn!;

    // Wait for cleanup task to complete
    await this.waitForTaskCompletion(taskArn);
  }

  private async waitForTaskCompletion(
    taskArn: string,
    maxWaitSeconds = 300
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitSeconds * 1000) {
      try {
        const command = new DescribeTasksCommand({
          cluster: process.env.CLUSTER_NAME!,
          tasks: [taskArn],
        });

        const response = await this.ecs.send(command);

        if (response.tasks && response.tasks.length > 0) {
          const task = response.tasks[0];
          const lastStatus = task.lastStatus;

          if (lastStatus === "STOPPED") {
            const exitCode = task.containers?.[0]?.exitCode;
            if (exitCode === 0) {
              console.log(`✅ EFS cleanup task completed successfully`);
              return;
            } else {
              throw new Error(
                `EFS cleanup task failed with exit code: ${exitCode}`
              );
            }
          }
        }
      } catch (error) {
        console.error("Error checking cleanup task status:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
    }

    throw new Error(
      `EFS cleanup task did not complete within ${maxWaitSeconds} seconds`
    );
  }

  private async waitForAccessPoint(
    accessPointId: string,
    maxWaitSeconds = 300
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitSeconds * 1000) {
      try {
        const command = new DescribeAccessPointsCommand({
          AccessPointId: accessPointId,
        });

        const response = await this.efs.send(command);

        if (response.AccessPoints && response.AccessPoints.length > 0) {
          const state = response.AccessPoints[0].LifeCycleState;
          if (state === "available") {
            return;
          } else if (state === "error") {
            throw new Error(`Access point ${accessPointId} creation failed`);
          }
        }
      } catch (error) {
        console.error("Error checking access point status:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds
    }

    throw new Error(
      `Access point ${accessPointId} did not become available within ${maxWaitSeconds} seconds`
    );
  }
}
