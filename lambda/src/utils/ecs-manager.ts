import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
  LogDriver,
} from "@aws-sdk/client-ecs";

export class ECSManager {
  private ecs: ECSClient;
  private clusterName: string;

  constructor(clusterName: string) {
    this.ecs = new ECSClient({ region: process.env.AWS_REGION || "us-east-1" });
    this.clusterName = clusterName;
  }

  async registerTaskDefinition(
    userId: string,
    sanitizedUsername: string,
    accessPointId: string,
    secretArn: string,
    s3BucketName?: string,
    s3AccessKeyId?: string,
    s3SecretAccessKey?: string,
    foundryVersion?: string
  ): Promise<string> {
    console.log(
      `Registering task definition for user ${userId} with accessPointId: ${accessPointId}`
    );
    const family = `foundry-${userId}`;

    const command = new RegisterTaskDefinitionCommand({
      family,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "1024",
      memory: "2048",
      executionRoleArn: process.env.EXECUTION_ROLE_ARN,
      taskRoleArn: process.env.TASK_ROLE_ARN,
      runtimePlatform: {
        cpuArchitecture: "ARM64", // Use ARM64 for cheaper Graviton instances
        operatingSystemFamily: "LINUX",
      },
      containerDefinitions: [
        ...(s3BucketName && s3AccessKeyId && s3SecretAccessKey
          ? [
              {
                name: "aws-config-creator",
                image: "alpine:latest",
                essential: false, // This sidecar can exit after creating the config
                command: [
                  "sh",
                  "-c",
                  `echo '${JSON.stringify({
                    buckets: [s3BucketName],
                    region: process.env.AWS_REGION || "us-east-1",
                    credentials: {
                      accessKeyId: s3AccessKeyId,
                      secretAccessKey: s3SecretAccessKey,
                    },
                  })}' > /data/awsConfig.json && echo 'AWS config created successfully'`,
                ],
                mountPoints: [
                  {
                    sourceVolume: "foundry-data",
                    containerPath: "/data",
                  },
                ],
                logConfiguration: {
                  logDriver: LogDriver.AWSLOGS,
                  options: {
                    "awslogs-group": `/ecs/foundry-${userId}`,
                    "awslogs-region": process.env.AWS_REGION || "us-east-1",
                    "awslogs-stream-prefix": "aws-config",
                    "awslogs-create-group": "true",
                  },
                },
              },
            ]
          : []),
        {
          name: "foundry",
          image: `felddy/foundryvtt:${foundryVersion || "13"}`,
          essential: true,
          portMappings: [
            {
              containerPort: 30000,
              protocol: "tcp",
            },
          ],
          ...(s3BucketName && s3AccessKeyId && s3SecretAccessKey
            ? {
                dependsOn: [
                  {
                    containerName: "aws-config-creator",
                    condition: "SUCCESS", // Wait for sidecar to complete successfully
                  },
                ],
              }
            : {}),
          logConfiguration: {
            logDriver: LogDriver.AWSLOGS,
            options: {
              "awslogs-group": `/aws/ecs/foundry-${userId}`,
              "awslogs-region": process.env.AWS_REGION || "us-east-1",
              "awslogs-stream-prefix": "foundry",
              "awslogs-create-group": "true",
            },
          },
          environment: [
            {
              name: "CONTAINER_PRESERVE_CONFIG",
              value: "true",
            },
            {
              name: "FOUNDRY_HOSTNAME",
              value: `${sanitizedUsername}.${process.env.DOMAIN_NAME}`,
            },
            {
              name: "FOUNDRY_LOCAL_HOSTNAME",
              value: `foundry-${sanitizedUsername}`, // Set consistent local hostname for license persistence
            },
            {
              name: "FOUNDRY_PROXY_SSL",
              value: "true", // Enable SSL proxy support for HTTPS
            },
            {
              name: "FOUNDRY_IP_DISCOVERY",
              value: "false", // Disable IP discovery to speed up startup
            },
            {
              name: "FOUNDRY_TELEMETRY",
              value: "false", // Disable telemetry
            },
            {
              name: "FOUNDRY_MINIFY_STATIC_FILES",
              value: "true", // Enable minification for better performance
            },
            {
              name: "FOUNDRY_COMPRESS_WEBSOCKET",
              value: "true", // Enable websocket compression
            },
            ...(s3BucketName && s3AccessKeyId && s3SecretAccessKey
              ? [
                  {
                    name: "FOUNDRY_AWS_CONFIG",
                    value: "/data/awsConfig.json", // Point to JSON config file created by sidecar
                  },
                ]
              : []),
          ],
          secrets: [
            {
              name: "FOUNDRY_USERNAME",
              valueFrom: `${secretArn}:username::`,
            },
            {
              name: "FOUNDRY_PASSWORD",
              valueFrom: `${secretArn}:password::`,
            },
            {
              name: "FOUNDRY_ADMIN_KEY",
              valueFrom: `${secretArn}:admin_key::`,
            },
          ],
          mountPoints: [
            {
              sourceVolume: "foundry-data",
              containerPath: "/data",
              readOnly: false,
            },
          ],
        },
      ],
      volumes: [
        {
          name: "foundry-data",
          efsVolumeConfiguration: {
            fileSystemId: process.env.FILE_SYSTEM_ID,
            transitEncryption: "ENABLED",
            authorizationConfig: {
              accessPointId,
            },
          },
        },
      ],
    });

    const response = await this.ecs.send(command);
    return response.taskDefinition!.taskDefinitionArn!;
  }

  async registerCleanupTaskDefinition(): Promise<string> {
    console.log("Registering EFS cleanup task definition");

    const family = "foundry-efs-cleanup";

    const command = new RegisterTaskDefinitionCommand({
      family,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256", // Minimal CPU for cleanup task
      memory: "512", // Minimal memory for cleanup task
      executionRoleArn: process.env.EXECUTION_ROLE_ARN,
      taskRoleArn: process.env.TASK_ROLE_ARN,
      runtimePlatform: {
        cpuArchitecture: "ARM64", // Use ARM64 for cheaper Graviton instances
        operatingSystemFamily: "LINUX",
      },
      containerDefinitions: [
        {
          name: "cleanup",
          image: "alpine:latest", // Lightweight image for file operations
          essential: true,
          logConfiguration: {
            logDriver: LogDriver.AWSLOGS,
            options: {
              "awslogs-group": "/aws/ecs/foundry-efs-cleanup",
              "awslogs-region": process.env.AWS_REGION || "us-east-1",
              "awslogs-stream-prefix": "cleanup",
              "awslogs-create-group": "true",
            },
          },
          command: [
            "sh",
            "-c",
            "echo 'Starting EFS cleanup for user:' $USER_ID && " +
              'if [ -d "/efs/foundry-instances/$USER_ID" ]; then ' +
              "  echo 'Removing directory: /efs/foundry-instances/$USER_ID' && " +
              '  rm -rf "/efs/foundry-instances/$USER_ID" && ' +
              "  echo 'EFS cleanup completed successfully'; " +
              "else " +
              "  echo 'Directory /efs/foundry-instances/$USER_ID does not exist, nothing to clean'; " +
              "fi",
          ],
          mountPoints: [
            {
              sourceVolume: "efs-root",
              containerPath: "/efs",
              readOnly: false,
            },
          ],
        },
      ],
      volumes: [
        {
          name: "efs-root",
          efsVolumeConfiguration: {
            fileSystemId: process.env.FILE_SYSTEM_ID,
            transitEncryption: "ENABLED",
            rootDirectory: "/", // Mount root to access all user directories
          },
        },
      ],
    });

    const response = await this.ecs.send(command);
    return response.taskDefinition!.taskDefinitionArn!;
  }

  async runTask(
    taskDefinitionArn: string,
    subnetIds: string[],
    securityGroupIds: string[]
  ): Promise<string> {
    const command = new RunTaskCommand({
      cluster: this.clusterName,
      taskDefinition: taskDefinitionArn,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: subnetIds,
          securityGroups: securityGroupIds,
          assignPublicIp: "DISABLED",
        },
      },
      count: 1,
    });

    const response = await this.ecs.send(command);

    if (response.failures && response.failures.length > 0) {
      throw new Error(
        `Failed to start task: ${JSON.stringify(response.failures)}`
      );
    }

    return response.tasks![0].taskArn!;
  }

  async stopTask(taskArn: string): Promise<void> {
    const command = new StopTaskCommand({
      cluster: this.clusterName,
      task: taskArn,
      reason: "User requested stop",
    });

    await this.ecs.send(command);
  }

  async getTaskStatus(taskArn: string): Promise<string | null> {
    try {
      const command = new DescribeTasksCommand({
        cluster: this.clusterName,
        tasks: [taskArn],
      });

      const response = await this.ecs.send(command);

      if (!response.tasks || response.tasks.length === 0) {
        return null;
      }

      const task = response.tasks[0];
      const lastStatus = task.lastStatus?.toLowerCase();

      // Map ECS statuses to our simplified statuses
      const statusMap: Record<string, string> = {
        pending: "starting",
        running: "running",
        stopping: "stopping",
        stopped: "stopped",
        deactivating: "stopping",
      };

      return statusMap[lastStatus || ""] || "unknown";
    } catch (error) {
      console.error("Error getting task status:", error);
      return null;
    }
  }

  async registerPermissionResetTaskDefinition(
    targetUid: number,
    targetGid: number
  ): Promise<string> {
    console.log(
      `Registering permission reset task definition for ${targetUid}:${targetGid}`
    );

    const family = "foundry-permission-reset";

    const command = new RegisterTaskDefinitionCommand({
      family,
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      cpu: "256", // Minimal CPU for reset task
      memory: "512", // Minimal memory for reset task
      executionRoleArn: process.env.EXECUTION_ROLE_ARN,
      taskRoleArn: process.env.TASK_ROLE_ARN,
      runtimePlatform: {
        cpuArchitecture: "ARM64", // Use ARM64 for cheaper Graviton instances
        operatingSystemFamily: "LINUX",
      },
      containerDefinitions: [
        {
          name: "permission-reset",
          image: "alpine:latest", // Lightweight image for file operations
          essential: true,
          logConfiguration: {
            logDriver: LogDriver.AWSLOGS,
            options: {
              "awslogs-group": "/aws/ecs/foundry-permission-reset",
              "awslogs-region": process.env.AWS_REGION || "us-east-1",
              "awslogs-stream-prefix": "reset",
              "awslogs-create-group": "true",
            },
          },
          command: [
            "sh",
            "-c",
            "echo 'Starting permission reset for user:' $USER_ID && " +
              "echo 'Setting ownership to " +
              targetUid +
              ":" +
              targetGid +
              "' && " +
              'if [ -d "/efs/foundry-instances/$USER_ID" ]; then ' +
              "  echo 'Resetting permissions in: /efs/foundry-instances/$USER_ID' && " +
              "  chown -R " +
              targetUid +
              ":" +
              targetGid +
              ' "/efs/foundry-instances/$USER_ID" && ' +
              "  echo 'Permission reset completed successfully'; " +
              "else " +
              "  echo 'Directory /efs/foundry-instances/$USER_ID does not exist, nothing to reset'; " +
              "fi",
          ],
          mountPoints: [
            {
              sourceVolume: "efs-root",
              containerPath: "/efs",
              readOnly: false,
            },
          ],
          environment: [
            {
              name: "USER_ID",
              value: "${USER_ID}", // Will be replaced at runtime
            },
          ],
        },
      ],
      volumes: [
        {
          name: "efs-root",
          efsVolumeConfiguration: {
            fileSystemId: process.env.FILE_SYSTEM_ID!,
            rootDirectory: "/",
            transitEncryption: "ENABLED",
          },
        },
      ],
    });

    const response = await this.ecs.send(command);

    console.log(`Permission reset task definition registered: ${family}`);
    return response.taskDefinition!.taskDefinitionArn!;
  }
}
