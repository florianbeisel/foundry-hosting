import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

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

  async getCurrentMonthUsage(): Promise<number> {
    const now = new Date();
    const monthKey = `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1)
      .toString()
      .padStart(2, "0")}`;

    let totalHours = 0;
    let ExclusiveStartKey: any = undefined;

    do {
      const scanResult = await this.docClient.send(
        new (
          await import("@aws-sdk/lib-dynamodb")
        ).ScanCommand({
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
