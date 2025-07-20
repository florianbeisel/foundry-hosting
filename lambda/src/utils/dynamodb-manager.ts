import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

interface FoundryInstance {
  userId: string;
  sanitizedUsername: string;
  status: string;
  accessPointId: string;
  secretArn: string;
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
}

export class DynamoDBManager {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(tableName: string) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.docClient = DynamoDBDocumentClient.from(client);
    this.tableName = tableName;
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
}
