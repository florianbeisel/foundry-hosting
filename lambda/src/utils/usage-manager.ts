import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export class UsageManager {
  private tableName: string;
  private docClient: DynamoDBDocumentClient;

  constructor(tableName: string) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = tableName;
  }

  private buildKey(userId: string, timestamp: number) {
    const date = new Date(timestamp * 1000);
    const monthKey = `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1)
      .toString()
      .padStart(2, "0")}`;
    return `${userId}#${monthKey}`;
  }

  async recordStart(userId: string, timestamp: number): Promise<void> {
    const usageKey = this.buildKey(userId, timestamp);
    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: { usageKey },
      UpdateExpression:
        "SET #ls = :ts, sessionsStarted = if_not_exists(sessionsStarted, :zero) + :one",
      ExpressionAttributeNames: {
        "#ls": "lastStart",
      },
      ExpressionAttributeValues: {
        ":ts": timestamp,
        ":zero": 0,
        ":one": 1,
      },
    });
    await this.docClient.send(command);
  }

  async recordStop(
    userId: string,
    startTimestamp: number,
    stopTimestamp: number
  ): Promise<void> {
    if (!startTimestamp) return;
    const durationHours = (stopTimestamp - startTimestamp) / 3600;
    if (durationHours <= 0) return;
    const usageKey = this.buildKey(userId, stopTimestamp);
    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: { usageKey },
      UpdateExpression:
        "SET hoursThisMonth = if_not_exists(hoursThisMonth, :zero) + :inc REMOVE lastStart",
      ExpressionAttributeValues: {
        ":inc": durationHours,
        ":zero": 0,
      },
    });
    await this.docClient.send(command);
  }

  /**
   * Record a donation/payment toward covering costs
   */
  async recordDonation(
    userId: string,
    amount: number,
    timestamp: number,
    donorName?: string
  ): Promise<void> {
    const usageKey = this.buildKey(userId, timestamp);
    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: { usageKey },
      UpdateExpression:
        "SET donationsThisMonth = if_not_exists(donationsThisMonth, :zero) + :amount, " +
        "lastDonation = :timestamp, " +
        "lastDonorName = :donorName",
      ExpressionAttributeValues: {
        ":amount": amount,
        ":zero": 0,
        ":timestamp": timestamp,
        ":donorName": donorName || "Anonymous",
      },
    });
    await this.docClient.send(command);
  }

  /**
   * Get detailed cost information for a specific user and month
   */
  async getUserMonthlyCosts(
    userId: string,
    year?: number,
    month?: number
  ): Promise<{
    hoursUsed: number;
    totalCost: number;
    uncoveredCost: number;
    donationsReceived: number;
    lastDonorName?: string;
    costPerHour: number;
  }> {
    const now = new Date();
    const targetYear = year || now.getUTCFullYear();
    const targetMonth = month || now.getUTCMonth() + 1;
    const monthKey = `${targetYear}-${targetMonth.toString().padStart(2, "0")}`;
    const usageKey = `${userId}#${monthKey}`;

    const COST_PER_HOUR = parseFloat(
      process.env.INSTANCE_COST_PER_HOUR || "0.10"
    );

    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { usageKey },
      })
    );

    const data = result.Item || {};
    const hoursUsed = data.hoursThisMonth || 0;
    const donationsReceived = data.donationsThisMonth || 0;
    const totalCost = hoursUsed * COST_PER_HOUR;
    const uncoveredCost = Math.max(0, totalCost - donationsReceived);

    return {
      hoursUsed,
      totalCost,
      uncoveredCost,
      donationsReceived,
      lastDonorName: data.lastDonorName,
      costPerHour: COST_PER_HOUR,
    };
  }

  /**
   * Get aggregated cost statistics for all users (admin overview)
   */
  async getAllUsersCosts(): Promise<{
    totalUsers: number;
    totalHours: number;
    totalCosts: number;
    totalDonations: number;
    totalUncovered: number;
    topContributors: Array<{
      userId: string;
      donations: number;
      uncovered: number;
    }>;
  }> {
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1)
      .toString()
      .padStart(2, "0")}`;

    const COST_PER_HOUR = parseFloat(
      process.env.INSTANCE_COST_PER_HOUR || "0.10"
    );
    let totalHours = 0;
    let totalDonations = 0;
    let userCount = 0;
    const contributors: Array<{
      userId: string;
      donations: number;
      uncovered: number;
    }> = [];
    let ExclusiveStartKey: any = undefined;

    do {
      const scanResult = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          ExclusiveStartKey,
          ProjectionExpression: "usageKey, hoursThisMonth, donationsThisMonth",
        })
      );

      if (scanResult.Items) {
        for (const item of scanResult.Items) {
          if (item.usageKey.endsWith(monthKey)) {
            const hours = Number(item.hoursThisMonth || 0);
            const donations = Number(item.donationsThisMonth || 0);
            const cost = hours * COST_PER_HOUR;
            const uncovered = Math.max(0, cost - donations);

            if (hours > 0 || donations > 0) {
              totalHours += hours;
              totalDonations += donations;
              userCount++;

              const userId = item.usageKey.split("#")[0];
              contributors.push({
                userId,
                donations,
                uncovered,
              });
            }
          }
        }
      }

      ExclusiveStartKey = scanResult.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    const totalCosts = totalHours * COST_PER_HOUR;
    const totalUncovered = Math.max(0, totalCosts - totalDonations);

    // Sort contributors by donation amount (descending)
    const topContributors = contributors
      .sort((a, b) => b.donations - a.donations)
      .slice(0, 10); // Top 10 contributors

    return {
      totalUsers: userCount,
      totalHours,
      totalCosts,
      totalDonations,
      totalUncovered,
      topContributors,
    };
  }

  async getCurrentMonthUsage(): Promise<number> {
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1)
      .toString()
      .padStart(2, "0")}`;

    let totalHours = 0;
    let ExclusiveStartKey: any = undefined;

    do {
      const scanResult = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          ExclusiveStartKey,
          ProjectionExpression: "usageKey, hoursThisMonth",
        })
      );

      if (scanResult.Items) {
        for (const item of scanResult.Items) {
          if (item.usageKey.endsWith(monthKey) && item.hoursThisMonth) {
            totalHours += Number(item.hoursThisMonth);
          }
        }
      }

      ExclusiveStartKey = scanResult.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    return totalHours;
  }
}
