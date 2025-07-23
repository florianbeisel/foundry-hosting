const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const botConfigTableName = process.env.BOT_CONFIG_TABLE_NAME;
let botConfigDynamo = null;

if (botConfigTableName) {
  const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  botConfigDynamo = DynamoDBDocumentClient.from(ddbClient);
}

async function loadConfigFromDatabase(client) {
  console.log("⚙️ Loading configuration from database...");
  
  if (!botConfigDynamo) {
    console.log("⚠️ DynamoDB not configured, skipping database config load");
    return;
  }

  try {
    // Load registration stats mapping
    const registrationMapping = await loadRegistrationStatsMapping();
    if (registrationMapping && registrationMapping.channelId && registrationMapping.messageId) {
      await validateAndRestoreMapping(
        client,
        registrationMapping,
        "registration",
        client.registrationStats
      );
    }

    // Load admin status mapping
    const adminMapping = await loadAdminStatusMapping();
    if (adminMapping && adminMapping.channelId && adminMapping.messageId) {
      await validateAndRestoreMapping(
        client,
        adminMapping,
        "admin",
        client.adminStatusMapping
      );
    }

    console.log("✅ Configuration loaded from database");
  } catch (error) {
    console.error("❌ Failed to load configuration from database:", error);
  }
}

async function validateAndRestoreMapping(client, mapping, type, mapStore) {
  console.log(
    `🔍 Found ${type} mapping: ${mapping.channelId} -> ${mapping.messageId}`
  );

  try {
    const channel = await client.channels.fetch(mapping.channelId);
    if (channel) {
      const message = await channel.messages.fetch(mapping.messageId);
      if (message) {
        mapStore.set(mapping.channelId, mapping.messageId);
        console.log(
          `✅ Validated and restored ${type} mapping from DynamoDB`
        );
      } else {
        console.log(
          `⚠️ ${type} message not found, will clean up on first refresh`
        );
      }
    } else {
      console.log(
        `⚠️ ${type} channel not found, will clean up on first refresh`
      );
    }
  } catch (error) {
    console.log(
      `⚠️ Error validating ${type} mapping: ${error.message}, will clean up on first refresh`
    );
  }
}

async function loadRegistrationStatsMapping() {
  if (!botConfigDynamo) return null;
  
  try {
    const res = await botConfigDynamo.send(
      new GetCommand({
        TableName: botConfigTableName,
        Key: { configKey: "registrationStats" },
      })
    );

    if (res.Item && res.Item.channelId && res.Item.messageId) {
      return res.Item;
    }

    // Fallback: scan for old entries
    const scanRes = await botConfigDynamo.send(
      new ScanCommand({
        TableName: botConfigTableName,
        FilterExpression: "contains(configKey, :key)",
        ExpressionAttributeValues: {
          ":key": "registration",
        },
      })
    );

    if (scanRes.Items && scanRes.Items.length > 0) {
      const validEntries = scanRes.Items.filter(
        (item) => item.channelId && item.messageId
      ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (validEntries.length > 0) {
        return validEntries[0];
      }
    }

    return null;
  } catch (err) {
    console.error("Failed to load registration mapping:", err.message);
    return null;
  }
}

async function loadAdminStatusMapping() {
  if (!botConfigDynamo) return null;
  
  try {
    const res = await botConfigDynamo.send(
      new GetCommand({
        TableName: botConfigTableName,
        Key: { configKey: "adminStatus" },
      })
    );

    if (res.Item && res.Item.channelId && res.Item.messageId) {
      return res.Item;
    }

    // Fallback: scan for old entries
    const scanRes = await botConfigDynamo.send(
      new ScanCommand({
        TableName: botConfigTableName,
        FilterExpression: "contains(configKey, :key)",
        ExpressionAttributeValues: {
          ":key": "admin",
        },
      })
    );

    if (scanRes.Items && scanRes.Items.length > 0) {
      const validEntries = scanRes.Items.filter(
        (item) => item.channelId && item.messageId
      ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (validEntries.length > 0) {
        return validEntries[0];
      }
    }

    return null;
  } catch (err) {
    console.error("Failed to load admin status mapping:", err.message);
    return null;
  }
}

module.exports = {
  loadConfigFromDatabase,
  botConfigDynamo,
  botConfigTableName,
};