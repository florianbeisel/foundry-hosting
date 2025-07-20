import { ECSClient, DescribeTasksCommand, Task } from "@aws-sdk/client-ecs";

export class TaskManager {
  private ecs: ECSClient;
  private clusterName: string;

  constructor(clusterName: string) {
    this.ecs = new ECSClient({ region: process.env.AWS_REGION || "us-east-1" });
    this.clusterName = clusterName;
  }

  async waitForTaskRunning(
    taskArn: string,
    maxWaitSeconds = 300
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitSeconds * 1000) {
      const task = await this.getTaskDetails(taskArn);

      if (!task) {
        throw new Error(`Task ${taskArn} not found`);
      }

      const lastStatus = task.lastStatus?.toLowerCase();

      if (lastStatus === "running") {
        return;
      } else if (lastStatus === "stopped") {
        throw new Error(`Task ${taskArn} stopped unexpectedly`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
    }

    throw new Error(
      `Task ${taskArn} did not start within ${maxWaitSeconds} seconds`
    );
  }

  async getTaskPrivateIp(taskArn: string): Promise<string> {
    const task = await this.getTaskDetails(taskArn);

    if (!task || !task.attachments) {
      throw new Error(`Task ${taskArn} not found or has no attachments`);
    }

    // Look for the ENI attachment
    for (const attachment of task.attachments) {
      if (attachment.type === "ElasticNetworkInterface" && attachment.details) {
        for (const detail of attachment.details) {
          if (detail.name === "privateIPv4Address" && detail.value) {
            return detail.value;
          }
        }
      }
    }

    throw new Error(`Private IP not found for task ${taskArn}`);
  }

  private async getTaskDetails(taskArn: string): Promise<Task | null> {
    try {
      const command = new DescribeTasksCommand({
        cluster: this.clusterName,
        tasks: [taskArn],
      });

      const response = await this.ecs.send(command);

      if (!response.tasks || response.tasks.length === 0) {
        return null;
      }

      return response.tasks[0];
    } catch (error) {
      console.error("Error getting task details:", error);
      return null;
    }
  }
}
