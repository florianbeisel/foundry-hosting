/*
 * discord/src/data/botConfig.js
 * High-level helper functions for the Bot Config DynamoDB table.
 */

const { botConfigTableName } = require("../config");
const { docClient, GetCommand, PutCommand, ScanCommand } = require("../aws/dynamo");

if (!botConfigTableName) {
  // We fail fast at module load time if the env var is missing.
  throw new Error("BOT_CONFIG_TABLE_NAME is not defined");
}

/**
 * Generic helper to get a config item by key.
 * @param {string} configKey
 */
async function getItem(configKey) {
  const res = await docClient.send(
    new GetCommand({ TableName: botConfigTableName, Key: { configKey } })
  );
  return res.Item ?? null;
}

/**
 * Put/update a config item.
 * @param {object} item – must include `configKey`.
 */
async function putItem(item) {
  await docClient.send(
    new PutCommand({ TableName: botConfigTableName, Item: item })
  );
  return true;
}

/**
 * Registration Stats Mapping helpers
 */
async function loadRegistrationStatsMapping() {
  const item = await getItem("registrationStats");
  if (item && item.channelId && item.messageId) return item;

  // If missing/invalid, attempt to find older entries for backwards compat
  const scanRes = await docClient.send(
    new ScanCommand({
      TableName: botConfigTableName,
      FilterExpression: "contains(configKey, :key)",
      ExpressionAttributeValues: { ":key": "registration" },
    })
  );

  const valid = (scanRes.Items || [])
    .filter((i) => i.channelId && i.messageId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return valid[0] ?? null;
}

async function saveRegistrationStatsMapping(channelId, messageId) {
  await putItem({
    configKey: "registrationStats",
    channelId,
    messageId,
    updatedAt: Math.floor(Date.now() / 1000),
  });
}

/**
 * Admin Status Mapping helpers
 */
async function loadAdminStatusMapping() {
  const item = await getItem("adminStatus");
  if (item && item.channelId && item.messageId) return item;

  const scanRes = await docClient.send(
    new ScanCommand({
      TableName: botConfigTableName,
      FilterExpression: "contains(configKey, :key)",
      ExpressionAttributeValues: { ":key": "admin" },
    })
  );

  const valid = (scanRes.Items || [])
    .filter((i) => i.channelId && i.messageId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return valid[0] ?? null;
}

async function saveAdminStatusMapping(channelId, messageId) {
  await putItem({
    configKey: "adminStatus",
    channelId,
    messageId,
    updatedAt: Math.floor(Date.now() / 1000),
  });
}

module.exports = {
  loadRegistrationStatsMapping,
  saveRegistrationStatsMapping,
  loadAdminStatusMapping,
  saveAdminStatusMapping,
};