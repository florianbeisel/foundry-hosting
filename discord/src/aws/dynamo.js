/*
 * discord/src/aws/dynamo.js
 * Provides a configured DynamoDB DocumentClient singleton.
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { awsRegion } = require("../config");

// Shared low-level client
const ddbClient = new DynamoDBClient({ region: awsRegion });

// Document client simplifies marshalling
const docClient = DynamoDBDocumentClient.from(ddbClient);

module.exports = {
  docClient,
  GetCommand,
  PutCommand,
  ScanCommand,
};