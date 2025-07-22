#!/usr/bin/env node

/**
 * Cleanup script for invalid Discord bot message mappings
 *
 * This script helps administrators clean up invalid message mappings
 * that may be stored in DynamoDB when the Discord bot loses track
 * of registration or admin status messages.
 *
 * Usage: node cleanup-mappings.js
 */

require("dotenv").config();
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const botConfigTableName = process.env.BOT_CONFIG_TABLE_NAME;

if (!botConfigTableName) {
  console.error("❌ BOT_CONFIG_TABLE_NAME environment variable not set");
  process.exit(1);
}

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});
const botConfigDynamo = DynamoDBDocumentClient.from(ddbClient);

async function cleanupMappings() {
  console.log("🧹 Starting cleanup of invalid message mappings...");

  try {
    // Scan for all registration-related entries
    console.log("\n📊 Scanning for registration-related entries...");
    const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

    const regScan = await botConfigDynamo.send(
      new ScanCommand({
        TableName: botConfigTableName,
        FilterExpression: "contains(configKey, :key)",
        ExpressionAttributeValues: {
          ":key": "registration",
        },
      })
    );

    if (regScan.Items && regScan.Items.length > 0) {
      console.log(
        `Found ${regScan.Items.length} registration-related entries:`
      );
      regScan.Items.forEach((item, index) => {
        const status =
          item.channelId && item.messageId ? "✅ Valid" : "❌ Invalid";
        const timestamp = item.updatedAt
          ? new Date(item.updatedAt * 1000).toISOString()
          : "Unknown";
        console.log(
          `  ${index + 1}. ${item.configKey}: ${item.channelId} -> ${
            item.messageId
          } (${status}, ${timestamp})`
        );
      });
    } else {
      console.log("No registration-related entries found");
    }

    // Scan for all admin-related entries
    console.log("\n🔧 Scanning for admin-related entries...");
    const adminScan = await botConfigDynamo.send(
      new ScanCommand({
        TableName: botConfigTableName,
        FilterExpression: "contains(configKey, :key)",
        ExpressionAttributeValues: {
          ":key": "admin",
        },
      })
    );

    if (adminScan.Items && adminScan.Items.length > 0) {
      console.log(`Found ${adminScan.Items.length} admin-related entries:`);
      adminScan.Items.forEach((item, index) => {
        const status =
          item.channelId && item.messageId ? "✅ Valid" : "❌ Invalid";
        const timestamp = item.updatedAt
          ? new Date(item.updatedAt * 1000).toISOString()
          : "Unknown";
        console.log(
          `  ${index + 1}. ${item.configKey}: ${item.channelId} -> ${
            item.messageId
          } (${status}, ${timestamp})`
        );
      });
    } else {
      console.log("No admin-related entries found");
    }

    // Check current primary mappings
    console.log("\n🎯 Checking current primary mappings...");
    const regStats = await botConfigDynamo.send(
      new GetCommand({
        TableName: botConfigTableName,
        Key: { configKey: "registrationStats" },
      })
    );

    if (regStats.Item && regStats.Item.channelId && regStats.Item.messageId) {
      console.log(
        `✅ Primary registration mapping: ${regStats.Item.channelId} -> ${regStats.Item.messageId}`
      );
    } else {
      console.log("❌ No primary registration mapping found");
    }

    const adminStatus = await botConfigDynamo.send(
      new GetCommand({
        TableName: botConfigTableName,
        Key: { configKey: "adminStatus" },
      })
    );

    if (
      adminStatus.Item &&
      adminStatus.Item.channelId &&
      adminStatus.Item.messageId
    ) {
      console.log(
        `✅ Primary admin mapping: ${adminStatus.Item.channelId} -> ${adminStatus.Item.messageId}`
      );
    } else {
      console.log("❌ No primary admin mapping found");
    }

    console.log("\n" + "=".repeat(60));
    console.log("DIAGNOSTIC INFORMATION:");
    console.log("=".repeat(60));
    console.log(
      "• The bot will automatically find and use the most recent valid mapping"
    );
    console.log("• Old entries are cleaned up automatically on bot restart");
    console.log(
      "• Use /foundry admin recreate-registration to recreate lost messages"
    );
    console.log(
      "• Use /foundry admin overview to recreate lost admin messages"
    );
    console.log("• Invalid mappings are cleaned up every 6 hours");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("❌ Error during cleanup:", error.message);
    process.exit(1);
  }
}

// Run the cleanup
cleanupMappings()
  .then(() => {
    console.log("\n✅ Cleanup check completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Cleanup failed:", error);
    process.exit(1);
  });
