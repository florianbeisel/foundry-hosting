import {
  DynamoDBManager,
  FoundryInstance,
  ScheduledSession,
} from "./dynamodb-manager";
import { ECSManager } from "./ecs-manager";
import { ALBManager } from "./alb-manager";
import { LicenseScheduler } from "./license-scheduler";

interface ShutdownResult {
  userId: string;
  reason: string;
  success: boolean;
  error?: string;
}

export class AutoShutdownManager {
  constructor(
    private dynamoManager: DynamoDBManager,
    private ecsManager: ECSManager,
    private albManager: ALBManager,
    private licenseScheduler: LicenseScheduler
  ) {}

  /**
   * Calculate auto-shutdown time for an instance based on its type
   */
  calculateAutoShutdownTime(
    startTime: number,
    licenseType: "byol" | "pooled" = "byol",
    linkedSessionId?: string
  ): number {
    if (licenseType === "byol") {
      // On-demand instances: 6 hours from start
      return startTime + 6 * 60 * 60; // 6 hours in seconds
    } else {
      // Scheduled instances: will be calculated based on session end time + 1 hour
      // For now, default to 4 hours if no session info available
      return startTime + 4 * 60 * 60;
    }
  }

  /**
   * Update auto-shutdown time for a scheduled instance based on its session
   */
  async updateScheduledInstanceShutdownTime(
    userId: string,
    sessionId: string
  ): Promise<void> {
    const session = await this.dynamoManager.getScheduledSession(sessionId);
    if (!session) {
      console.warn(
        `Session ${sessionId} not found when updating shutdown time`
      );
      return;
    }

    // Scheduled instances: shutdown 1 hour after session end
    const autoShutdownAt = session.endTime + 60 * 60; // 1 hour after session end

    await this.dynamoManager.updateInstance(userId, {
      autoShutdownAt,
      linkedSessionId: sessionId,
      updatedAt: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Check and shutdown instances that have exceeded their time limits
   */
  async checkAndShutdownExpiredInstances(): Promise<{
    shutdownCount: number;
    results: ShutdownResult[];
  }> {
    const currentTime = Math.floor(Date.now() / 1000);
    const results: ShutdownResult[] = [];

    // Get instances that should be auto-shutdown
    const expiredInstances =
      await this.dynamoManager.getInstancesForAutoShutdown(currentTime);

    console.log(`Found ${expiredInstances.length} instances for auto-shutdown`);

    for (const instance of expiredInstances) {
      try {
        const reason = this.getShutdownReason(instance, currentTime);
        await this.shutdownInstance(instance.userId, reason);

        results.push({
          userId: instance.userId,
          reason,
          success: true,
        });
      } catch (error) {
        console.error(
          `Failed to auto-shutdown instance for user ${instance.userId}:`,
          error
        );
        results.push({
          userId: instance.userId,
          reason: "Auto-shutdown failed",
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      shutdownCount: results.filter((r) => r.success).length,
      results,
    };
  }

  /**
   * Emergency shutdown of on-demand instances when needed for scheduled sessions
   */
  async emergencyShutdownForScheduledSession(
    excludeUserId: string,
    requiredLicenseId: string
  ): Promise<string[]> {
    const allInstances = await this.dynamoManager.getAllInstances();
    const shutdownUserIds: string[] = [];

    // Find running on-demand instances using the required license
    const conflictingInstances = allInstances.filter(
      (instance) =>
        instance.userId !== excludeUserId &&
        instance.status === "running" &&
        instance.licenseType === "byol" &&
        instance.licenseOwnerId === requiredLicenseId
    );

    for (const instance of conflictingInstances) {
      try {
        await this.shutdownInstance(
          instance.userId,
          "Shutdown for scheduled session priority"
        );
        shutdownUserIds.push(instance.userId);
      } catch (error) {
        console.error(
          `Failed to emergency shutdown instance for user ${instance.userId}:`,
          error
        );
      }
    }

    return shutdownUserIds;
  }

  /**
   * Determine the reason for shutdown based on instance properties
   */
  private getShutdownReason(
    instance: FoundryInstance,
    currentTime: number
  ): string {
    if (instance.licenseType === "byol" && !instance.linkedSessionId) {
      const hoursRunning = Math.floor(
        (currentTime - (instance.startedAt || 0)) / 3600
      );
      return `Auto-shutdown: On-demand instance ran for ${hoursRunning} hours (6h limit)`;
    } else if (instance.licenseType === "pooled" || instance.linkedSessionId) {
      return "Auto-shutdown: Scheduled session ended + 1 hour grace period";
    } else {
      return "Auto-shutdown: Time limit exceeded";
    }
  }

  /**
   * Shutdown an individual instance
   */
  private async shutdownInstance(
    userId: string,
    reason: string
  ): Promise<void> {
    const instance = await this.dynamoManager.getInstance(userId);
    if (!instance || instance.status !== "running") {
      return;
    }

    console.log(`Auto-shutting down instance for user ${userId}: ${reason}`);

    // Deregister from ALB first
    if (instance.taskPrivateIp && instance.targetGroupArn) {
      await this.albManager.deregisterTaskFromTargetGroup(
        instance.targetGroupArn,
        instance.taskPrivateIp
      );
    }

    // Delete ALB listener rule
    if (instance.albRuleArn) {
      await this.albManager.deleteListenerRule(instance.albRuleArn);
    }

    // Stop ECS task
    if (instance.taskArn) {
      await this.ecsManager.stopTask(instance.taskArn);
    }

    // Update instance status
    await this.dynamoManager.updateInstance(userId, {
      status: "stopped",
      taskArn: undefined,
      taskPrivateIp: undefined,
      albRuleArn: undefined,
      autoShutdownAt: undefined,
      startedAt: undefined,
      linkedSessionId: undefined,
      updatedAt: Math.floor(Date.now() / 1000),
    });

    // If this was a scheduled session instance, mark the session as completed
    if (instance.linkedSessionId) {
      try {
        await this.dynamoManager.updateScheduledSession(
          instance.linkedSessionId,
          {
            status: "completed",
            updatedAt: Math.floor(Date.now() / 1000),
          }
        );
      } catch (error) {
        console.error(
          `Failed to update session status for ${instance.linkedSessionId}:`,
          error
        );
      }
    }
  }

  /**
   * Check for scheduled sessions that need to start soon and ensure licenses are available
   */
  async prepareForUpcomingSessions(): Promise<{
    sessionsStarted: number;
    conflictsResolved: number;
  }> {
    const currentTime = Math.floor(Date.now() / 1000);
    const lookAhead = 5 * 60; // 5 minutes

    // Get sessions starting soon
    const upcomingSessions = await this.dynamoManager.getSessionsInTimeRange(
      currentTime,
      currentTime + lookAhead
    );

    let sessionsStarted = 0;
    let conflictsResolved = 0;

    for (const session of upcomingSessions) {
      // Start sessions that are scheduled and their start time has arrived
      if (session.status === "scheduled" && session.startTime <= currentTime) {
        try {
          console.log(
            `Starting scheduled session ${session.sessionId} for user ${session.userId}`
          );

          // Check for conflicting instances and shut them down
          if (session.licenseId) {
            const shutdownUsers =
              await this.emergencyShutdownForScheduledSession(
                session.userId,
                session.licenseId
              );
            conflictsResolved += shutdownUsers.length;

            // Wait a moment for shutdowns to complete
            if (shutdownUsers.length > 0) {
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
          }

          // Actually start the scheduled session and instance
          const startResult = await this.licenseScheduler.startScheduledSession(
            session.sessionId
          );

          if (startResult.success) {
            console.log(
              `✅ Successfully started scheduled session ${session.sessionId}`
            );
            sessionsStarted++;

            // Send Discord notification to user that their session has started
            try {
              const notificationPayload = {
                action: "send-notification",
                userId: "system", // System call
                notificationType: "session-ready",
                targetUserId: session.userId,
                message: `Your scheduled session "${
                  session.title || "Foundry VTT Session"
                }" is now ready!`,
                sessionId: session.sessionId,
                instanceUrl: startResult.instanceUrl,
              };

              // Note: In a real implementation, this would call the Discord bot
              // For now, we'll log it and the Discord bot can poll for notifications
              console.log(
                "📢 Session ready notification:",
                notificationPayload
              );
            } catch (notificationError) {
              console.error(
                "Failed to send session ready notification:",
                notificationError
              );
            }
          } else {
            console.error(
              `❌ Failed to start scheduled session ${session.sessionId}: ${startResult.message}`
            );

            // TODO: Send Discord notification to user about the failure
            // Mark session as failed/cancelled
            await this.dynamoManager.updateScheduledSession(session.sessionId, {
              status: "cancelled",
              updatedAt: currentTime,
            });
          }
        } catch (error) {
          console.error(`Failed to start session ${session.sessionId}:`, error);
        }
      }
    }

    return { sessionsStarted, conflictsResolved };
  }

  /**
   * Get statistics about running instances and their shutdown times
   */
  async getAutoShutdownStats(): Promise<{
    totalRunning: number;
    scheduledForShutdown: number;
    overdue: number;
    nextShutdownIn: number | null;
  }> {
    const currentTime = Math.floor(Date.now() / 1000);
    const allInstances = await this.dynamoManager.getAllInstances();

    const runningInstances = allInstances.filter((i) => i.status === "running");
    const scheduledForShutdown = runningInstances.filter(
      (i) => i.autoShutdownAt
    ).length;
    const overdue = runningInstances.filter(
      (i) => i.autoShutdownAt && i.autoShutdownAt <= currentTime
    ).length;

    // Find next shutdown time
    const nextShutdowns = runningInstances
      .filter((i) => i.autoShutdownAt && i.autoShutdownAt > currentTime)
      .map((i) => i.autoShutdownAt!)
      .sort((a, b) => a - b);

    const nextShutdownIn =
      nextShutdowns.length > 0 ? nextShutdowns[0] - currentTime : null;

    return {
      totalRunning: runningInstances.length,
      scheduledForShutdown,
      overdue,
      nextShutdownIn,
    };
  }
}
