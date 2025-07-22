import { DynamoDBManager } from "./dynamodb-manager";
import { ECSManager } from "./ecs-manager";
import { SecretsManager } from "./secrets-manager";
import { v4 as uuidv4 } from "uuid";

interface LicenseAvailability {
  available: boolean;
  conflictingInstances?: string[]; // User IDs of conflicting instances
  conflictingSessions?: string[]; // Session IDs of conflicting sessions
  availableLicenses?: string[]; // Available license IDs for pooled requests
}

interface ScheduleRequest {
  userId: string;
  username: string;
  startTime: number;
  endTime: number;
  licenseType: "byol" | "pooled";
  title?: string;
  description?: string;
  preferredLicenseId?: string; // For BYOL users scheduling their own license
}

export class LicenseScheduler {
  constructor(
    private dynamoManager: DynamoDBManager,
    private ecsManager: ECSManager,
    private secretsManager: SecretsManager
  ) {}

  /**
   * Check if a license is available for the given time period
   */
  async checkLicenseAvailability(
    licenseType: "byol" | "pooled",
    startTime: number,
    endTime: number,
    preferredLicenseId?: string,
    requestingUserId?: string
  ): Promise<LicenseAvailability> {
    if (licenseType === "byol" && preferredLicenseId) {
      return this.checkBYOLAvailability(preferredLicenseId, startTime, endTime);
    } else if (licenseType === "pooled") {
      return this.checkPooledLicenseAvailability(
        startTime,
        endTime,
        requestingUserId
      );
    }

    return { available: false };
  }

  /**
   * Check availability for a specific BYOL license
   */
  private async checkBYOLAvailability(
    licenseId: string,
    startTime: number,
    endTime: number
  ): Promise<LicenseAvailability> {
    const license = await this.dynamoManager.getLicensePool(licenseId);
    if (!license || !license.isActive) {
      return { available: false };
    }

    // Check for existing reservations
    const reservations = await this.dynamoManager.getLicenseReservations(
      licenseId,
      startTime,
      endTime
    );

    // Check for running instances using this license
    const allInstances = await this.dynamoManager.getAllInstances();
    const conflictingInstances = allInstances
      .filter(
        (instance) =>
          instance.licenseOwnerId === licenseId &&
          (instance.status === "running" || instance.status === "starting")
      )
      .map((instance) => instance.userId);

    // Check for scheduled sessions
    const conflictingSessions = await this.dynamoManager.getSessionsInTimeRange(
      startTime,
      endTime
    );
    const conflictingSessionIds = conflictingSessions
      .filter(
        (session) =>
          session.licenseId === licenseId && session.status !== "cancelled"
      )
      .map((session) => session.sessionId);

    const hasConflicts =
      reservations.length > 0 ||
      conflictingInstances.length > 0 ||
      conflictingSessionIds.length > 0;

    return {
      available: !hasConflicts,
      conflictingInstances:
        conflictingInstances.length > 0 ? conflictingInstances : undefined,
      conflictingSessions:
        conflictingSessionIds.length > 0 ? conflictingSessionIds : undefined,
    };
  }

  /**
   * Check availability for pooled licenses with smart prioritization
   */
  private async checkPooledLicenseAvailability(
    startTime: number,
    endTime: number,
    requestingUserId?: string
  ): Promise<LicenseAvailability> {
    const activeLicenses = await this.dynamoManager.getAllActiveLicenses();
    const availableLicenses: string[] = [];
    const userOwnLicense = `byol-${requestingUserId}`;

    // First, check if the user has their own license available (prioritize it)
    let userLicenseAvailable = false;
    if (requestingUserId) {
      const userLicense = activeLicenses.find(
        (l) => l.licenseId === userOwnLicense
      );
      if (userLicense) {
        const availability = await this.checkBYOLAvailability(
          userOwnLicense,
          startTime,
          endTime
        );
        if (availability.available) {
          availableLicenses.push(userOwnLicense);
          userLicenseAvailable = true;
        }
      }
    }

    // Then check other available licenses (but only if user's own license isn't available)
    for (const license of activeLicenses) {
      if (license.licenseId === userOwnLicense) continue; // Already checked above

      const availability = await this.checkBYOLAvailability(
        license.licenseId,
        startTime,
        endTime
      );
      if (availability.available) {
        availableLicenses.push(license.licenseId);
      }
    }

    return {
      available: availableLicenses.length > 0,
      availableLicenses,
    };
  }

  /**
   * Schedule a session and handle license conflicts
   */
  async scheduleSession(request: ScheduleRequest): Promise<{
    success: boolean;
    sessionId?: string;
    message: string;
    conflictsResolved?: string[];
  }> {
    const sessionId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // Check availability
    const availability = await this.checkLicenseAvailability(
      request.licenseType,
      request.startTime,
      request.endTime,
      request.preferredLicenseId,
      request.userId // Pass user ID for smart license prioritization
    );

    if (!availability.available) {
      return {
        success: false,
        message: "No licenses available for the requested time period",
      };
    }

    // Determine which license to use
    let assignedLicenseId: string | undefined;
    if (request.licenseType === "byol" && request.preferredLicenseId) {
      assignedLicenseId = request.preferredLicenseId;
    } else if (
      request.licenseType === "pooled" &&
      availability.availableLicenses
    ) {
      // Use the first available license (now prioritized with user's own license first)
      assignedLicenseId = availability.availableLicenses[0];
      console.log(
        `Assigned license for pooled session: ${assignedLicenseId} from available: [${availability.availableLicenses.join(
          ", "
        )}]`
      );
    }

    if (!assignedLicenseId) {
      return {
        success: false,
        message: "Unable to assign a license",
      };
    }

    // Handle conflicts if necessary (shutdown conflicting instances)
    const conflictsResolved: string[] = [];
    if (availability.conflictingInstances) {
      for (const userId of availability.conflictingInstances) {
        try {
          await this.shutdownInstanceForScheduledSession(userId, sessionId);
          conflictsResolved.push(userId);
        } catch (error) {
          console.error(
            `Failed to shutdown instance for user ${userId}:`,
            error
          );
        }
      }
    }

    // Create the scheduled session
    const session = {
      sessionId,
      userId: request.userId,
      username: request.username,
      licenseType: request.licenseType,
      licenseId: assignedLicenseId,
      startTime: request.startTime,
      endTime: request.endTime,
      status: "scheduled" as const,
      title: request.title,
      description: request.description,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamoManager.createScheduledSession(session);

    // Create license reservation
    const reservation = {
      reservationId: uuidv4(),
      licenseId: assignedLicenseId,
      sessionId,
      userId: request.userId,
      startTime: request.startTime,
      endTime: request.endTime,
      status: "active" as const,
      createdAt: now,
    };

    await this.dynamoManager.createLicenseReservation(reservation);

    return {
      success: true,
      sessionId,
      message: "Session scheduled successfully",
      conflictsResolved:
        conflictsResolved.length > 0 ? conflictsResolved : undefined,
    };
  }

  /**
   * Shutdown an instance to make room for a scheduled session
   */
  private async shutdownInstanceForScheduledSession(
    userId: string,
    scheduledSessionId: string
  ): Promise<void> {
    const instance = await this.dynamoManager.getInstance(userId);
    if (!instance || instance.status !== "running") {
      return;
    }

    console.log(
      `Shutting down instance for user ${userId} due to scheduled session ${scheduledSessionId}`
    );

    // Stop the instance (reuse existing stop logic)
    if (instance.taskArn) {
      await this.ecsManager.stopTask(instance.taskArn);
    }

    await this.dynamoManager.updateInstance(userId, {
      status: "stopped",
      taskArn: undefined,
      taskPrivateIp: undefined,
      albRuleArn: undefined,
      updatedAt: Math.floor(Date.now() / 1000),
    });

    // TODO: Send notification to user about the shutdown
  }

  /**
   * Start a scheduled session when the time comes
   */
  async startScheduledSession(sessionId: string): Promise<{
    success: boolean;
    message: string;
    instanceUrl?: string;
  }> {
    const session = await this.dynamoManager.getScheduledSession(sessionId);
    if (!session) {
      return { success: false, message: "Session not found" };
    }

    if (session.status !== "scheduled") {
      return { success: false, message: "Session is not in scheduled state" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (now < session.startTime) {
      return { success: false, message: "Session start time has not arrived" };
    }

    try {
      // Get the user's instance
      const instance = await this.dynamoManager.getInstance(session.userId);

      if (!instance) {
        return {
          success: false,
          message:
            "User must register an instance before starting a scheduled session",
        };
      }

      // If instance is already running, stop it first to properly configure it for the scheduled session
      if (instance.status === "running") {
        console.log(
          `Stopping running instance for user ${session.userId} to start scheduled session`
        );
        await this.shutdownInstanceForScheduledSession(
          session.userId,
          sessionId
        );
        // Wait a moment for the shutdown to complete
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Update instance with scheduled session configuration
      await this.dynamoManager.updateInstance(session.userId, {
        licenseType: session.licenseType,
        licenseOwnerId: session.licenseId,
        linkedSessionId: sessionId,
        updatedAt: now,
      });

      // Start the instance using existing ECS logic
      const startResult = await this.startInstanceForScheduledSession(
        session.userId,
        session
      );

      if (startResult.success) {
        // Update session status
        await this.dynamoManager.updateScheduledSession(sessionId, {
          status: "active",
          instanceId: session.userId,
          updatedAt: now,
        });

        return {
          success: true,
          message: "Scheduled session started successfully",
          instanceUrl: startResult.instanceUrl,
        };
      } else {
        return {
          success: false,
          message: `Failed to start instance: ${startResult.error}`,
        };
      }
    } catch (error) {
      console.error("Failed to start scheduled session:", error);
      return {
        success: false,
        message: `Failed to start session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * Start an instance for a scheduled session using existing ECS logic
   */
  private async startInstanceForScheduledSession(
    userId: string,
    session: any
  ): Promise<{
    success: boolean;
    instanceUrl?: string;
    error?: string;
  }> {
    try {
      const instance = await this.dynamoManager.getInstance(userId);
      if (!instance || !instance.targetGroupArn) {
        return {
          success: false,
          error: "Instance not found or missing target group",
        };
      }

      if (instance.status === "running") {
        // Instance is already running, just update the auto-shutdown time
        const autoShutdownAt = session.endTime + 60 * 60; // 1 hour after session end
        await this.dynamoManager.updateInstance(userId, {
          autoShutdownAt,
          linkedSessionId: session.sessionId,
          updatedAt: Math.floor(Date.now() / 1000),
        });

        return {
          success: true,
          instanceUrl: `https://${instance.sanitizedUsername}.${process.env.DOMAIN_NAME}`,
        };
      }

      // For pooled instances with dynamic license assignment, we need to update credentials
      console.log(
        `Starting pooled instance for session. Instance licenseType: ${instance.licenseType}, session.licenseId: ${session.licenseId}, instance.licenseOwnerId: ${instance.licenseOwnerId}`
      );

      if (
        instance.licenseType === "pooled" &&
        session.licenseId &&
        (!instance.licenseOwnerId ||
          instance.licenseOwnerId !== session.licenseId)
      ) {
        // This is a dynamic pooled instance that needs license owner's credentials
        const licenseOwnerIdMatch = session.licenseId.match(/^byol-(.+)$/);
        if (licenseOwnerIdMatch) {
          const licenseOwnerId = licenseOwnerIdMatch[1];

          // Get the license owner's credentials
          const ownerCredentials = await this.secretsManager.getCredentials(
            licenseOwnerId
          );
          if (!ownerCredentials) {
            throw new Error(
              `License owner credentials not found for ${session.licenseId}`
            );
          }

          // Get the existing admin key from the pooled instance
          const pooledCredentials = await this.secretsManager.getCredentials(
            userId
          );
          const adminKey = pooledCredentials?.admin_key || "defaultadminkey";

          // Update the pooled instance's credentials with license owner's login
          await this.secretsManager.storeCredentials(
            userId,
            ownerCredentials.username,
            ownerCredentials.password,
            adminKey
          );

          console.log(
            `Updated pooled instance ${userId} credentials to use license ${session.licenseId} from owner ${licenseOwnerId}`
          );
        }

        // Update the instance record to track the assigned license
        await this.dynamoManager.updateInstance(userId, {
          licenseOwnerId: session.licenseId,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }

      // Register task definition and start task
      const taskDefinitionArn = await this.ecsManager.registerTaskDefinition(
        userId,
        instance.sanitizedUsername,
        instance.accessPointId,
        instance.secretArn,
        instance.s3BucketName,
        instance.s3AccessKeyId,
        instance.s3SecretAccessKey,
        instance.foundryVersion
      );

      const taskArn = await this.ecsManager.runTask(
        taskDefinitionArn,
        process.env.PRIVATE_SUBNET_IDS!.split(","),
        [process.env.TASK_SECURITY_GROUP_ID!]
      );

      // Note: In a real implementation, we'd wait for the task to be running and get the IP
      // For now, we'll update the instance immediately and let the existing monitoring handle the rest
      const now = Math.floor(Date.now() / 1000);
      const autoShutdownAt = session.endTime + 60 * 60; // 1 hour after session end

      await this.dynamoManager.updateInstance(userId, {
        status: "running",
        taskArn,
        taskDefinitionArn,
        startedAt: now,
        autoShutdownAt,
        linkedSessionId: session.sessionId,
        updatedAt: now,
      });

      const instanceUrl = `https://${instance.sanitizedUsername}.${process.env.DOMAIN_NAME}`;

      return {
        success: true,
        instanceUrl,
      };
    } catch (error) {
      console.error("Error starting instance for scheduled session:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * End a scheduled session
   */
  async endScheduledSession(sessionId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const session = await this.dynamoManager.getScheduledSession(sessionId);
    if (!session) {
      return { success: false, message: "Session not found" };
    }

    if (session.status !== "active") {
      return { success: false, message: "Session is not active" };
    }

    try {
      const now = Math.floor(Date.now() / 1000);

      // Stop the instance
      if (session.instanceId) {
        await this.shutdownInstanceForScheduledSession(
          session.instanceId,
          sessionId
        );
      }

      // Update session status
      await this.dynamoManager.updateScheduledSession(sessionId, {
        status: "completed",
        updatedAt: now,
      });

      // Mark reservation as completed
      const reservations = await this.dynamoManager.getLicenseReservations(
        session.licenseId!,
        session.startTime,
        session.endTime
      );

      for (const reservation of reservations) {
        if (reservation.sessionId === sessionId) {
          await this.dynamoManager.updateLicenseReservation(
            reservation.reservationId,
            {
              status: "completed",
            }
          );
        }
      }

      return {
        success: true,
        message: "Scheduled session ended successfully",
      };
    } catch (error) {
      console.error("Failed to end scheduled session:", error);
      return {
        success: false,
        message: `Failed to end session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * Check if a user can start an on-demand instance (for BYOL)
   */
  async canStartOnDemandInstance(userId: string): Promise<{
    canStart: boolean;
    reason?: string;
    conflictingSession?: string;
  }> {
    const instance = await this.dynamoManager.getInstance(userId);
    if (!instance) {
      return { canStart: false, reason: "No instance found" };
    }

    if (instance.licenseType !== "byol") {
      return {
        canStart: false,
        reason: "Only BYOL instances can start on-demand",
      };
    }

    // Check if there's a scheduled session using this user's license
    const now = Math.floor(Date.now() / 1000);
    const upcomingSessions = await this.dynamoManager.getSessionsInTimeRange(
      now,
      now + 7 * 24 * 60 * 60 // Next 7 days
    );

    const conflictingSession = upcomingSessions.find(
      (session) =>
        session.licenseId === instance.licenseOwnerId &&
        session.status === "scheduled" &&
        session.startTime <= now + 30 * 60 && // Starting within 30 minutes
        session.endTime > now
    );

    if (conflictingSession) {
      return {
        canStart: false,
        reason: "A scheduled session is about to start using this license",
        conflictingSession: conflictingSession.sessionId,
      };
    }

    return { canStart: true };
  }
}
