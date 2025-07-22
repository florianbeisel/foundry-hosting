import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

export interface FoundryInstance {
  userId: string;
  sanitizedUsername: string;
  status: string;
  accessPointId: string;
  secretArn?: string; // Optional for dynamic pooled instances that don't have credentials initially
  adminKey: string;
  foundryVersion?: string;
  s3BucketName?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  taskArn?: string;
  taskDefinitionArn?: string;
  targetGroupArn?: string;
  albRulePriority?: number;
  taskPrivateIp?: string;
  albRuleArn?: string;
  createdAt: number;
  updatedAt: number;
  // License management fields
  licenseType?: "byol" | "pooled"; // Bring Your Own License or Pooled
  licenseOwnerId?: string; // For pooled licenses, who owns the license being used
  allowLicenseSharing?: boolean; // For BYOL users, whether they share their license to the pool
  maxConcurrentUsers?: number; // For license owners, how many concurrent users allowed
  // Enhanced license state management
  stopSharingAfterSessions?: boolean; // Flag to stop sharing after current sessions end
  licenseSharingScheduledStop?: number; // Timestamp when sharing should stop (after sessions)
  licenseSharingState?: "active" | "scheduled_stop" | "inactive" | "orphaned"; // Current sharing state
  lastLicenseSharingChange?: number; // Timestamp of last sharing state change
  // Auto-shutdown fields
  startedAt?: number; // When the instance was started (for auto-shutdown)
  autoShutdownAt?: number; // When the instance should be automatically shut down
  linkedSessionId?: string; // For scheduled instances, which session they're linked to
}

export interface LicensePool {
  licenseId: string; // Unique license identifier
  ownerId: string; // Discord user ID of license owner
  ownerUsername: string; // For display purposes
  maxConcurrentUsers: number; // How many instances can use this license
  isActive: boolean; // Whether this license is available for pooling
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledSession {
  sessionId: string; // UUID for the session
  userId: string; // Who scheduled it
  username: string; // For display
  licenseType: "byol" | "pooled";
  licenseId?: string; // Specific license if pooled
  startTime: number; // Unix timestamp
  endTime: number; // Unix timestamp
  status: "scheduled" | "active" | "completed" | "cancelled";
  title?: string; // Optional session name
  description?: string; // Optional description
  instanceId?: string; // Associated instance when active
  createdAt: number;
  updatedAt: number;
}

export interface LicenseReservation {
  reservationId: string; // UUID
  licenseId: string; // Which license is reserved
  sessionId: string; // Which session reserved it
  userId: string; // Who made the reservation
  startTime: number;
  endTime: number;
  status: "active" | "completed" | "cancelled";
  createdAt: number;
}

export class DynamoDBManager {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;
  private licensePoolTableName: string;
  private scheduledSessionsTableName: string;
  private licenseReservationsTableName: string;

  constructor(tableName: string) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = tableName;
    // Additional table names for license management from environment variables
    this.licensePoolTableName =
      process.env.LICENSE_POOL_TABLE_NAME || `${tableName}-license-pool`;
    this.scheduledSessionsTableName =
      process.env.SCHEDULED_SESSIONS_TABLE_NAME ||
      `${tableName}-scheduled-sessions`;
    this.licenseReservationsTableName =
      process.env.LICENSE_RESERVATIONS_TABLE_NAME ||
      `${tableName}-license-reservations`;
  }

  async getInstance(userId: string): Promise<FoundryInstance | null> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { userId },
      });

      const response = await this.docClient.send(command);
      return (response.Item as FoundryInstance) || null;
    } catch (error) {
      console.error("Error getting instance:", error);
      return null;
    }
  }

  async createInstance(instance: FoundryInstance): Promise<FoundryInstance> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: instance,
    });

    await this.docClient.send(command);
    return instance;
  }

  async updateInstance(
    userId: string,
    updates: Partial<FoundryInstance>
  ): Promise<void> {
    // Separate SET operations (defined values) from REMOVE operations (undefined values)
    const setUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );
    const removeKeys = Object.keys(updates).filter(
      (key) => updates[key as keyof FoundryInstance] === undefined
    );

    if (Object.keys(setUpdates).length === 0 && removeKeys.length === 0) {
      // No updates to perform
      return;
    }

    // Build update expression
    const updateExpressionParts: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Add SET expression for defined values
    if (Object.keys(setUpdates).length > 0) {
      const setExpression = Object.keys(setUpdates)
        .map((key) => {
          expressionAttributeNames[`#${key}`] = key;
          expressionAttributeValues[`:${key}`] =
            setUpdates[key as keyof FoundryInstance];
          return `#${key} = :${key}`;
        })
        .join(", ");
      updateExpressionParts.push(`SET ${setExpression}`);
    }

    // Add REMOVE expression for undefined values
    if (removeKeys.length > 0) {
      const removeExpression = removeKeys
        .map((key) => {
          expressionAttributeNames[`#${key}`] = key;
          return `#${key}`;
        })
        .join(", ");
      updateExpressionParts.push(`REMOVE ${removeExpression}`);
    }

    const updateExpression = updateExpressionParts.join(" ");

    const commandInput: any = {
      TableName: this.tableName,
      Key: { userId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
    };

    // Only include ExpressionAttributeValues if we have SET operations
    if (Object.keys(expressionAttributeValues).length > 0) {
      commandInput.ExpressionAttributeValues = expressionAttributeValues;
    }

    const command = new UpdateCommand(commandInput);

    await this.docClient.send(command);
  }

  async deleteInstance(userId: string): Promise<void> {
    const command = new DeleteCommand({
      TableName: this.tableName,
      Key: { userId },
    });

    await this.docClient.send(command);
  }

  async getAllInstances(): Promise<FoundryInstance[]> {
    try {
      const command = new ScanCommand({
        TableName: this.tableName,
      });

      const response = await this.docClient.send(command);
      return (response.Items as FoundryInstance[]) || [];
    } catch (error) {
      console.error("Error getting all instances:", error);
      return [];
    }
  }

  // License Pool Management
  async createLicensePool(license: LicensePool): Promise<LicensePool> {
    const command = new PutCommand({
      TableName: this.licensePoolTableName,
      Item: license,
    });
    await this.docClient.send(command);
    return license;
  }

  async getLicensePool(licenseId: string): Promise<LicensePool | null> {
    try {
      const command = new GetCommand({
        TableName: this.licensePoolTableName,
        Key: { licenseId },
      });
      const response = await this.docClient.send(command);
      return (response.Item as LicensePool) || null;
    } catch (error) {
      console.error("Error getting license pool:", error);
      return null;
    }
  }

  async getAllActiveLicenses(): Promise<LicensePool[]> {
    try {
      const command = new ScanCommand({
        TableName: this.licensePoolTableName,
        FilterExpression: "isActive = :active",
        ExpressionAttributeValues: { ":active": true },
      });
      const response = await this.docClient.send(command);
      return (response.Items as LicensePool[]) || [];
    } catch (error) {
      console.error("Error getting active licenses:", error);
      return [];
    }
  }

  async getAllLicenses(): Promise<LicensePool[]> {
    try {
      const command = new ScanCommand({
        TableName: this.licensePoolTableName,
      });
      const response = await this.docClient.send(command);
      return (response.Items as LicensePool[]) || [];
    } catch (error) {
      console.error("Error getting all licenses:", error);
      return [];
    }
  }

  async updateLicensePool(
    licenseId: string,
    updates: Partial<LicensePool>
  ): Promise<void> {
    const setUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );

    if (Object.keys(setUpdates).length === 0) return;

    const updateExpression = `SET ${Object.keys(setUpdates)
      .map((key) => `#${key} = :${key}`)
      .join(", ")}`;

    const expressionAttributeNames = Object.fromEntries(
      Object.keys(setUpdates).map((key) => [`#${key}`, key])
    );
    const expressionAttributeValues = Object.fromEntries(
      Object.entries(setUpdates).map(([key, value]) => [`:${key}`, value])
    );

    const command = new UpdateCommand({
      TableName: this.licensePoolTableName,
      Key: { licenseId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await this.docClient.send(command);
  }

  // Scheduled Sessions Management
  async createScheduledSession(
    session: ScheduledSession
  ): Promise<ScheduledSession> {
    const command = new PutCommand({
      TableName: this.scheduledSessionsTableName,
      Item: session,
    });
    await this.docClient.send(command);
    return session;
  }

  async getScheduledSession(
    sessionId: string
  ): Promise<ScheduledSession | null> {
    try {
      const command = new GetCommand({
        TableName: this.scheduledSessionsTableName,
        Key: { sessionId },
      });
      const response = await this.docClient.send(command);
      return (response.Item as ScheduledSession) || null;
    } catch (error) {
      console.error("Error getting scheduled session:", error);
      return null;
    }
  }

  async getUserScheduledSessions(userId: string): Promise<ScheduledSession[]> {
    try {
      const command = new QueryCommand({
        TableName: this.scheduledSessionsTableName,
        IndexName: "userId-index", // Requires GSI on userId
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
      });
      const response = await this.docClient.send(command);
      return (response.Items as ScheduledSession[]) || [];
    } catch (error) {
      console.error("Error getting user scheduled sessions:", error);
      return [];
    }
  }

  async getSessionsInTimeRange(
    startTime: number,
    endTime: number
  ): Promise<ScheduledSession[]> {
    try {
      const command = new ScanCommand({
        TableName: this.scheduledSessionsTableName,
        FilterExpression:
          "(startTime BETWEEN :start AND :end) OR (endTime BETWEEN :start AND :end) OR (startTime <= :start AND endTime >= :end)",
        ExpressionAttributeValues: {
          ":start": startTime,
          ":end": endTime,
        },
      });
      const response = await this.docClient.send(command);
      return (response.Items as ScheduledSession[]) || [];
    } catch (error) {
      console.error("Error getting sessions in time range:", error);
      return [];
    }
  }

  async updateScheduledSession(
    sessionId: string,
    updates: Partial<ScheduledSession>
  ): Promise<void> {
    const setUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );

    if (Object.keys(setUpdates).length === 0) return;

    const updateExpression = `SET ${Object.keys(setUpdates)
      .map((key) => `#${key} = :${key}`)
      .join(", ")}`;

    const expressionAttributeNames = Object.fromEntries(
      Object.keys(setUpdates).map((key) => [`#${key}`, key])
    );
    const expressionAttributeValues = Object.fromEntries(
      Object.entries(setUpdates).map(([key, value]) => [`:${key}`, value])
    );

    const command = new UpdateCommand({
      TableName: this.scheduledSessionsTableName,
      Key: { sessionId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await this.docClient.send(command);
  }

  // License Reservations Management
  async createLicenseReservation(
    reservation: LicenseReservation
  ): Promise<LicenseReservation> {
    const command = new PutCommand({
      TableName: this.licenseReservationsTableName,
      Item: reservation,
    });
    await this.docClient.send(command);
    return reservation;
  }

  async getLicenseReservations(
    licenseId: string,
    startTime: number,
    endTime: number
  ): Promise<LicenseReservation[]> {
    try {
      const command = new QueryCommand({
        TableName: this.licenseReservationsTableName,
        IndexName: "licenseId-startTime-index", // Requires GSI
        KeyConditionExpression:
          "licenseId = :licenseId AND startTime BETWEEN :start AND :end",
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":licenseId": licenseId,
          ":start": startTime,
          ":end": endTime,
          ":status": "active",
        },
      });
      const response = await this.docClient.send(command);
      return (response.Items as LicenseReservation[]) || [];
    } catch (error) {
      console.error("Error getting license reservations:", error);
      return [];
    }
  }

  async getAllActiveLicenseReservations(): Promise<LicenseReservation[]> {
    try {
      const command = new ScanCommand({
        TableName: this.licenseReservationsTableName,
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "active",
        },
      });
      const response = await this.docClient.send(command);
      return (response.Items as LicenseReservation[]) || [];
    } catch (error) {
      console.error("Error getting all active license reservations:", error);
      return [];
    }
  }

  async cancelLicenseReservation(reservationId: string): Promise<void> {
    await this.updateLicenseReservation(reservationId, { status: "cancelled" });
  }

  async updateLicenseReservation(
    reservationId: string,
    updates: Partial<LicenseReservation>
  ): Promise<void> {
    const setUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );

    if (Object.keys(setUpdates).length === 0) return;

    const updateExpression = `SET ${Object.keys(setUpdates)
      .map((key) => `#${key} = :${key}`)
      .join(", ")}`;

    const expressionAttributeNames = Object.fromEntries(
      Object.keys(setUpdates).map((key) => [`#${key}`, key])
    );
    const expressionAttributeValues = Object.fromEntries(
      Object.entries(setUpdates).map(([key, value]) => [`:${key}`, value])
    );

    const command = new UpdateCommand({
      TableName: this.licenseReservationsTableName,
      Key: { reservationId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await this.docClient.send(command);
  }

  // Auto-shutdown management
  async getInstancesForAutoShutdown(
    currentTime: number
  ): Promise<FoundryInstance[]> {
    try {
      const command = new ScanCommand({
        TableName: this.tableName,
        FilterExpression:
          "#status = :running AND autoShutdownAt <= :currentTime",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":running": "running",
          ":currentTime": currentTime,
        },
      });
      const response = await this.docClient.send(command);
      return (response.Items as FoundryInstance[]) || [];
    } catch (error) {
      console.error("Error getting instances for auto-shutdown:", error);
      return [];
    }
  }

  async getRunningInstancesOlderThan(
    ageInSeconds: number
  ): Promise<FoundryInstance[]> {
    const cutoffTime = Math.floor(Date.now() / 1000) - ageInSeconds;
    try {
      const command = new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "#status = :running AND startedAt <= :cutoff",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":running": "running",
          ":cutoff": cutoffTime,
        },
      });
      const response = await this.docClient.send(command);
      return (response.Items as FoundryInstance[]) || [];
    } catch (error) {
      console.error("Error getting old running instances:", error);
      return [];
    }
  }
}
