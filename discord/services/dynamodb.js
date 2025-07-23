const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  DeleteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const botConfigTableName = process.env.BOT_CONFIG_TABLE_NAME;
let botConfigDynamo = null;

if (botConfigTableName) {
  const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  botConfigDynamo = DynamoDBDocumentClient.from(ddbClient);
}

/**
 * Load registration stats mapping from the database
 * @returns {Promise<Object|null>}
 */
async function loadRegistrationStatsMappingFromDB() {
  if (!botConfigDynamo) return null;
  try {
    // First try to get the specific item
    const res = await botConfigDynamo.send(
      new GetCommand({
        TableName: botConfigTableName,
        Key: { configKey: "registrationStats" },
      })
    );

    if (res.Item && res.Item.channelId && res.Item.messageId) {
      console.log(
        `📊 Found registration stats mapping: ${res.Item.channelId} -> ${res.Item.messageId} (updated: ${res.Item.updatedAt})`
      );
      return res.Item;
    }

    // If no valid mapping found, try to scan for any registration-related entries
    console.log(
      "🔍 No valid registration stats mapping found, scanning for old entries..."
    );

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
      // Find the most recent valid entry
      const validEntries = scanRes.Items.filter(
        (item) => item.channelId && item.messageId
      ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (validEntries.length > 0) {
        const latest = validEntries[0];
        console.log(
          `📊 Found old registration stats mapping: ${latest.channelId} -> ${latest.messageId} (key: ${latest.configKey})`
        );
        return latest;
      }
    }

    console.log("❌ No registration stats mapping found in database");
    return null;
  } catch (error) {
    console.error("Error loading registration stats mapping:", error);
    return null;
  }
}

/**
 * Save registration stats mapping to the database
 * @param {string} channelId
 * @param {string} messageId
 * @returns {Promise<void>}
 */
async function saveRegistrationStatsMappingToDB(channelId, messageId) {
  if (!botConfigDynamo) return;
  try {
    await botConfigDynamo.send(
      new PutCommand({
        TableName: botConfigTableName,
        Item: {
          configKey: "registrationStats",
          channelId,
          messageId,
          updatedAt: Date.now(),
        },
      })
    );
    console.log(
      `💾 Saved registration stats mapping to DB: ${channelId} -> ${messageId}`
    );
  } catch (error) {
    console.error("Error saving registration stats mapping:", error);
  }
}

/**
 * Get an item from the database
 * @param {string} key
 * @returns {Promise<Object|null>}
 */
async function getItem(key) {
  if (!botConfigDynamo) return null;
  try {
    const res = await botConfigDynamo.send(
      new GetCommand({
        TableName: botConfigTableName,
        Key: { configKey: key },
      })
    );
    return res.Item || null;
  } catch (error) {
    console.error(`Error getting item ${key}:`, error);
    return null;
  }
}

/**
 * Put an item in the database
 * @param {string} key
 * @param {Object} data
 * @returns {Promise<void>}
 */
async function putItem(key, data) {
  if (!botConfigDynamo) return;
  try {
    await botConfigDynamo.send(
      new PutCommand({
        TableName: botConfigTableName,
        Item: {
          configKey: key,
          ...data,
          updatedAt: Date.now(),
        },
      })
    );
  } catch (error) {
    console.error(`Error putting item ${key}:`, error);
  }
}

/**
 * Delete an item from the database
 * @param {string} key
 * @returns {Promise<void>}
 */
async function deleteItem(key) {
  if (!botConfigDynamo) return;
  try {
    await botConfigDynamo.send(
      new DeleteCommand({
        TableName: botConfigTableName,
        Key: { configKey: key },
      })
    );
  } catch (error) {
    console.error(`Error deleting item ${key}:`, error);
  }
}

/**
 * Save admin status mapping to the database
 * @param {string} channelId
 * @param {string} messageId
 * @returns {Promise<boolean>}
 */
async function saveAdminStatusMappingToDB(channelId, messageId) {
  if (!botConfigDynamo) return false;
  try {
    await botConfigDynamo.send(
      new PutCommand({
        TableName: botConfigTableName,
        Item: {
          configKey: "adminStatus",
          channelId,
          messageId,
          updatedAt: Date.now(),
        },
      })
    );
    console.log(
      `💾 Saved admin status mapping to DB: ${channelId} -> ${messageId}`
    );
    return true;
  } catch (error) {
    console.error("Error saving admin status mapping:", error);
    return false;
  }
}

/**
 * Load admin status mapping from the database
 * @returns {Promise<Object|null>}
 */
async function loadAdminStatusMappingFromDB() {
  if (!botConfigDynamo) return null;
  try {
    const res = await botConfigDynamo.send(
      new GetCommand({
        TableName: botConfigTableName,
        Key: { configKey: "adminStatus" },
      })
    );
    return res.Item || null;
  } catch (error) {
    console.error("Error loading admin status mapping:", error);
    return null;
  }
}

module.exports = {
  loadRegistrationStatsMappingFromDB,
  saveRegistrationStatsMappingToDB,
  saveAdminStatusMappingToDB,
  loadAdminStatusMappingFromDB,
  getItem,
  putItem,
  deleteItem,
  botConfigDynamo,
};