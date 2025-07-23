require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require("discord.js");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const cron = require("node-cron");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

// Import constants
const {
  SUPPORTER_ROLES,
  CHANNEL_NAMES,
  COLORS,
  STATUS_EMOJIS,
  INTERVALS,
  LIMITS,
  MESSAGES,
} = require("./constants");

// ================================================================================
// DISCORD BOT FOR FOUNDRY VTT MANAGEMENT
// ================================================================================
// This file contains the complete Discord bot implementation for managing
// Foundry VTT instances. The code is organized into the following sections:
//
// 1. Configuration and Constants
// 2. Database Operations
// 3. Logging and Console Setup
// 4. UI Components and Embeds
// 5. Utility Functions
// 6. Channel Management
// 7. AWS Lambda Operations
// 8. Permission Utilities
// 9. Monitoring and Status
// 10. Bot Events and Initialization
// 11. Interaction Handlers
// 12. Command Handlers
// 13. Button Interaction Handlers
// 14. Modal Handlers
// 15. Select Menu Handlers
// 16. Registration and Stats
// 17. Admin Functions
// 18. Unified Dashboard
// ================================================================================

// =================
// SUPPORTER ROLES
// =================


// ================================================================================
// CONFIGURATION AND CONSTANTS
// ================================================================================

function getUserSupporterAmount(member) {
  if (!member) return 0;

  for (const [roleId, amount] of Object.entries(SUPPORTER_ROLES)) {
    if (member.roles.cache.has(roleId)) {
      return amount;
    }
  }

  return 0;
}
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

const botConfigTableName = process.env.BOT_CONFIG_TABLE_NAME;
let botConfigDynamo = null;
if (botConfigTableName) {
  const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  botConfigDynamo = DynamoDBDocumentClient.from(ddbClient);
}


// ================================================================================
// DATABASE OPERATIONS
// ================================================================================
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
    const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

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
          `🔄 Found ${validEntries.length} old registration entries, using most recent: ${latest.channelId} -> ${latest.messageId}`
        );

        // Clean up old entries
        for (let i = 1; i < validEntries.length; i++) {
          try {
            await botConfigDynamo.send(
              new PutCommand({
                TableName: botConfigTableName,
                Item: {
                  configKey: `registrationStats_old_${i}`,
                  channelId: null,
                  messageId: null,
                  updatedAt: Math.floor(Date.now() / 1000),
                  cleanedUp: true,
                },
              })
            );
          } catch (cleanupErr) {
            console.log(
              `⚠️ Could not clean up old entry ${i}: ${cleanupErr.message}`
            );
          }
        }

        return latest;
      }
    }

    return null;
  } catch (err) {
    console.error("Failed to load registration mapping:", err.message);
    return null;
  }
}

async function saveRegistrationStatsMappingToDB(channelId, messageId) {
  if (!botConfigDynamo) {
    console.error(
      "❌ botConfigDynamo not initialized - BOT_CONFIG_TABLE_NAME may not be set"
    );
    return false;
  }

  try {
    console.log(
      `💾 Saving registration stats mapping: ${channelId} -> ${messageId} to table ${botConfigTableName}`
    );

    await botConfigDynamo.send(
      new PutCommand({
        TableName: botConfigTableName,
        Item: {
          configKey: "registrationStats",
          channelId,
          messageId,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      })
    );

    console.log(`✅ Successfully saved registration stats mapping to DynamoDB`);
    return true;
  } catch (err) {
    console.error(
      "❌ Failed to save registration mapping to DynamoDB:",
      err.message
    );
    console.error("❌ Error details:", {
      tableName: botConfigTableName,
      channelId,
      messageId,
      errorCode: err.code,
      errorType: err.name,
    });
    return false;
  }
}

async function loadAdminStatusMappingFromDB() {
  if (!botConfigDynamo) return null;
  try {
    // First try to get the specific item
    const res = await botConfigDynamo.send(
      new GetCommand({
        TableName: botConfigTableName,
        Key: { configKey: "adminStatus" },
      })
    );

    if (res.Item && res.Item.channelId && res.Item.messageId) {
      console.log(
        `🔧 Found admin status mapping: ${res.Item.channelId} -> ${res.Item.messageId} (updated: ${res.Item.updatedAt})`
      );
      return res.Item;
    }

    // If no valid mapping found, try to scan for any admin-related entries
    console.log(
      "🔍 No valid admin status mapping found, scanning for old entries..."
    );
    const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

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
      // Find the most recent valid entry
      const validEntries = scanRes.Items.filter(
        (item) => item.channelId && item.messageId
      ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      if (validEntries.length > 0) {
        const latest = validEntries[0];
        console.log(
          `🔄 Found ${validEntries.length} old admin status entries, using most recent: ${latest.channelId} -> ${latest.messageId}`
        );

        // Clean up old entries
        for (let i = 1; i < validEntries.length; i++) {
          try {
            await botConfigDynamo.send(
              new PutCommand({
                TableName: botConfigTableName,
                Item: {
                  configKey: `adminStatus_old_${i}`,
                  channelId: null,
                  messageId: null,
                  updatedAt: Math.floor(Date.now() / 1000),
                  cleanedUp: true,
                },
              })
            );
          } catch (cleanupErr) {
            console.log(
              `⚠️ Could not clean up old admin entry ${i}: ${cleanupErr.message}`
            );
          }
        }

        return latest;
      }
    }

    return null;
  } catch (err) {
    console.error("Failed to load admin status mapping:", err.message);
    return null;
  }
}

async function saveAdminStatusMappingToDB(channelId, messageId) {
  if (!botConfigDynamo) {
    console.error(
      "❌ botConfigDynamo not initialized - BOT_CONFIG_TABLE_NAME may not be set"
    );
    return false;
  }

  try {
    console.log(
      `💾 Saving admin status mapping: ${channelId} -> ${messageId} to table ${botConfigTableName}`
    );

    await botConfigDynamo.send(
      new PutCommand({
        TableName: botConfigTableName,
        Item: {
          configKey: "adminStatus",
          channelId,
          messageId,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      })
    );

    console.log(`✅ Successfully saved admin status mapping to DynamoDB`);
    return true;
  } catch (err) {
    console.error(
      "❌ Failed to save admin status mapping to DynamoDB:",
      err.message
    );
    console.error("❌ Error details:", {
      tableName: botConfigTableName,
      channelId,
      messageId,
      errorCode: err.code,
      errorType: err.name,
    });
    return false;
  }
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// =================
// LOGGING CHANNEL SETUP
// =================

let loggingChannel = null;
let logQueue = [];
let isProcessingLogs = false;


// ================================================================================
// LOGGING AND CONSOLE SETUP
// ================================================================================
async function setupLoggingChannel() {
  try {
    // Find the first guild (server) the bot is in
    const guild = client.guilds.cache.first();
    if (!guild) {
      console.log("⚠️ No guilds found, cannot create logging channel");
      return;
    }

    // Check if logging channel already exists
    let existingChannel = guild.channels.cache.find(
      (c) => c.name === CHANNEL_NAMES.LOGGING
    );

    if (existingChannel) {
      loggingChannel = existingChannel;
      console.log(`📝 Using existing logging channel: #${loggingChannel.name}`);
    } else {
      // Create new logging channel
      loggingChannel = await guild.channels.create({
        name: CHANNEL_NAMES.LOGGING,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
            ],
          },
        ],
        topic: "Foundry VTT Bot logs and debugging information",
      });
      console.log(`📝 Created new logging channel: #${loggingChannel.name}`);
    }

    // Send startup message
    const startupEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🤖 Bot Startup")
      .setDescription(
        `Foundry VTT Bot started successfully at <t:${Math.floor(
          Date.now() / 1000
        )}:F>`
      )
      .addFields([
        {
          name: "Bot Info",
          value: `**Tag:** ${client.user.tag}\n**ID:** ${client.user.id}\n**Servers:** ${client.guilds.cache.size}`,
          inline: true,
        },
        {
          name: "Environment",
          value: `**Region:** ${
            process.env.AWS_REGION || "us-east-1"
          }\n**Table:** ${process.env.BOT_CONFIG_TABLE_NAME || "Not set"}`,
          inline: true,
        },
      ])
      .setTimestamp();

    await loggingChannel.send({ embeds: [startupEmbed] });

    // Setup console override
    setupConsoleOverride();
  } catch (error) {
    console.error("❌ Failed to setup logging channel:", error.message);
  }
}

function setupConsoleOverride() {
  if (!loggingChannel) return;

  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // Override console.log
  console.log = function (...args) {
    originalConsoleLog.apply(console, args);
    queueLogMessage("INFO", args.join(" "));
  };

  // Override console.error
  console.error = function (...args) {
    originalConsoleError.apply(console, args);
    queueLogMessage("ERROR", args.join(" "));
  };

  // Override console.warn
  console.warn = function (...args) {
    originalConsoleWarn.apply(console, args);
    queueLogMessage("WARN", args.join(" "));
  };

  console.log(
    "📝 Console logging override enabled - all logs will be sent to Discord"
  );
}

async function queueLogMessage(level, message) {
  if (!loggingChannel) return;

  // Skip certain messages to avoid spam
  const skipPatterns = [
    "heartbeat",
    "Gateway",
    "WebSocket",
    "Rate limit",
    "Request to use",
    "Missing Permissions",
    "Unknown interaction",
    "Unknown Message",
    "Unknown Channel",
  ];

  if (skipPatterns.some((pattern) => message.includes(pattern))) {
    return;
  }

  // Truncate very long messages
  if (message.length > 1900) {
    message = message.substring(0, 1900) + "...";
  }

  logQueue.push({ level, message, timestamp: Date.now() });

  if (!isProcessingLogs) {
    processLogQueue();
  }
}

async function processLogQueue() {
  if (isProcessingLogs || !loggingChannel || logQueue.length === 0) return;

  isProcessingLogs = true;

  try {
    // Process up to 10 messages at a time
    const messagesToProcess = logQueue.splice(0, 10);

    // Group messages by level
    const groupedMessages = {};
    messagesToProcess.forEach(({ level, message, timestamp }) => {
      if (!groupedMessages[level]) {
        groupedMessages[level] = [];
      }
      groupedMessages[level].push({ message, timestamp });
    });

    // Send grouped messages
    for (const [level, messages] of Object.entries(groupedMessages)) {
      if (messages.length === 0) continue;

      const levelEmoji = {
        INFO: "ℹ️",
        WARN: "⚠️",
        ERROR: "❌",
      };

      const levelColor = {
        INFO: "#0099ff",
        WARN: "#ffaa00",
        ERROR: "#ff0000",
      };

      const embed = new EmbedBuilder()
        .setColor(levelColor[level])
        .setTitle(`${levelEmoji[level]} ${level} Logs`)
        .setDescription(
          messages
            .map(
              ({ message, timestamp }) =>
                `**<t:${Math.floor(timestamp / 1000)}:T>** ${message}`
            )
            .join("\n")
        )
        .setTimestamp();

      try {
        await loggingChannel.send({ embeds: [embed] });
        // Small delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error("Failed to send log message to Discord:", error.message);
      }
    }
  } catch (error) {
    console.error("Error processing log queue:", error.message);
  } finally {
    isProcessingLogs = false;

    // Process remaining messages if any
    if (logQueue.length > 0) {
      setTimeout(processLogQueue, 1000);
    }
  }
}

// Initialize AWS Lambda client
const lambda = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// Store commands and active monitoring
client.commands = new Collection();
client.userChannels = new Map(); // userId -> channelId
client.statusMonitors = new Map(); // userId -> interval

// Map of registration channels to their statistics message IDs
client.registrationStats = new Map(); // channelId -> statsMessageId

// Map of admin status channels to their status message IDs
client.adminStatusMapping = new Map(); // channelId -> adminStatusMessageId

// Map of user status messages to their message IDs
client.userStatusMessages = new Map(); // userId -> messageId
client.userDashboardMessages = new Map(); // userId -> dashboard messageId

// Store last known status for each user to avoid unnecessary updates
const lastKnownStatus = new Map(); // userId -> { status, updatedAt, url }

// Helper function to build status embed for message updates

// ================================================================================
// UI COMPONENTS AND EMBEDS
// ================================================================================
async function buildStatusEmbed(status) {
  const statusEmoji = {
    running: "🟢",
    starting: "🟡",
    stopping: "🟠",
    stopped: "🔴",
    created: "⚪",
    unknown: "❔",
  };

  // Get monthly cost data with supporter information
  let costData = null;
  try {
    // Note: buildStatusEmbed doesn't have access to guild, so we can't get supporter info here
    // This function is used in contexts where we don't have guild access
    const costResult = await invokeLambda({
      action: "get-user-costs",
      userId: status.userId,
    });
    costData = costResult;
  } catch (error) {
    console.log("Could not fetch cost data for status embed:", error);
  }

  // Get license owner info for gratitude display on shared instances
  let licenseOwnerInfo = null;
  if (status.licenseType === "pooled" && status.licenseOwnerId) {
    try {
      const adminResult = await invokeLambda({
        action: "admin-overview",
        userId: status.userId,
      });

      if (adminResult.licenses && adminResult.licenses.pools) {
        const licensePool = adminResult.licenses.pools.find(
          (pool) => pool.licenseId === status.licenseOwnerId
        );
        if (licensePool) {
          licenseOwnerInfo = licensePool.ownerUsername;
        }
      }
    } catch (error) {
      console.log("Could not fetch license owner info for status embed");
    }
  }

  const embed = new EmbedBuilder()
    .setColor(status.status === "starting" ? "#ffff00" : "#888888")
    .setTitle(`${statusEmoji[status.status]} Instance Status`)
    .setDescription(`Current status: **${status.status}**`)
    .addFields([
      {
        name: "Last Updated",
        value: `<t:${status.updatedAt}:R>`,
        inline: true,
      },
      ...(costData
        ? [
            {
              name: "💰 This Month",
              value: `${costData.hoursUsed.toFixed(
                1
              )}h = $${costData.totalCost.toFixed(2)}${
                costData.uncoveredCost > 0
                  ? ` (💸$${costData.uncoveredCost.toFixed(2)} uncovered)`
                  : " ✅"
              }`,
              inline: true,
            },
          ]
        : []),
      ...(licenseOwnerInfo
        ? [
            {
              name: "🤝 License Pooled By",
              value: `Thanks to **${licenseOwnerInfo}** for pooling their license!`,
              inline: false,
            },
          ]
        : []),
    ])
    .setTimestamp();

  if (status.status === "starting") {
    embed.addFields([
      { name: "Progress", value: "Starting up Foundry VTT...", inline: true },
    ]);
  }

  return embed;
}

// Dynamically import all command modules
const fs = require("node:fs");
const path = require("node:path");

const commandsPath = path.join(__dirname, "commands");

fs.readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"))
  .forEach((file) => {
    const command = require(path.join(commandsPath, file));
    if (command?.data && typeof command.execute === "function") {
      client.commands.set(command.data.name, command);
    }
  });

// Helper function to sanitize Discord username for URL use

// ================================================================================
// UTILITY FUNCTIONS
// ================================================================================
function sanitizeUsername(username) {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-") // Replace non-alphanumeric chars with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .substring(0, 32); // Limit length for ALB target group name constraints
}

// Helper function to clear all messages from a channel
async function clearChannelMessages(channel) {
  try {
    console.log(`Clearing messages in ${channel.name} for fresh start...`);

    let deleted = 0;
    let lastMessageId;

    while (true) {
      // Fetch messages in batches
      const fetchOptions = { limit: 100 };
      if (lastMessageId) {
        fetchOptions.before = lastMessageId;
      }

      const messages = await channel.messages.fetch(fetchOptions);

      if (messages.size === 0) {
        break; // No more messages
      }

      // Filter messages by age for bulk delete vs individual delete
      const now = Date.now();
      const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

      const recentMessages = [];
      const oldMessages = [];

      messages.forEach((msg) => {
        if (msg.createdTimestamp > twoWeeksAgo) {
          recentMessages.push(msg);
        } else {
          oldMessages.push(msg);
        }
      });

      // Bulk delete recent messages
      if (recentMessages.length > 0) {
        if (recentMessages.length === 1) {
          await recentMessages[0].delete();
          deleted += 1;
        } else {
          await channel.bulkDelete(recentMessages);
          deleted += recentMessages.length;
        }
      }

      // Delete old messages individually
      for (const msg of oldMessages) {
        try {
          await msg.delete();
          deleted++;
          await new Promise((resolve) => setTimeout(resolve, 100)); // Rate limit protection
        } catch (err) {
          console.log(`Could not delete old message: ${err.message}`);
        }
      }

      // Update last message ID for next iteration
      lastMessageId = messages.last()?.id;

      // If we got less than 100 messages, we're done
      if (messages.size < 100) {
        break;
      }
    }

    console.log(`✅ Cleared ${deleted} messages from ${channel.name}`);
  } catch (error) {
    console.log(
      `Could not clear messages in ${channel.name}: ${error.message}`
    );
  }
}

// Helper function to get status emoji
function getStatusEmoji(status) {
  return STATUS_EMOJIS[status] || STATUS_EMOJIS.unknown;
}

/**
 * Create Ko-fi donation button row for supporting the server
 * @param {string} userId - Discord user ID
 * @param {number} suggestedAmount - Optional suggested donation amount
 * @param {string} message - Custom message for Ko-fi
 */
function createKofiSupportButton(
  userId,
  suggestedAmount = null,
  message = null
) {
  if (!process.env.KOFI_URL) return null;

  const defaultMessage = `Discord: ${userId} - Thanks for the awesome Foundry hosting service!`;
  const kofiMessage = message || defaultMessage;
  const buttonLabel = suggestedAmount
    ? `☕ Cover $${suggestedAmount.toFixed(2)} on Ko-fi`
    : "☕ Support the Server on Ko-fi";

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setURL(process.env.KOFI_URL)
      .setLabel(buttonLabel)
      .setStyle(ButtonStyle.Link)
      .setEmoji("💖")
  );
}

// Helper function to find existing command channel for a user

// ================================================================================
// CHANNEL MANAGEMENT
// ================================================================================
async function findExistingCommandChannel(guild, userId, username) {
  await guild.channels.fetch(); // Ensure we have all channels in cache

  const expectedChannelName = `foundry-${username}-${userId.slice(-4)}`;
  let channel = null;

  // Search strategy 1: Exact name match (current username)
  channel = guild.channels.cache.find((ch) => ch.name === expectedChannelName);

  // Search strategy 2: Topic contains user ID
  if (!channel) {
    channel = guild.channels.cache.find((ch) => ch.topic?.includes(userId));
  }

  // Search strategy 3: Name pattern with user ID suffix (in case username changed)
  if (!channel) {
    const userIdSuffix = userId.slice(-4);
    channel = guild.channels.cache.find(
      (ch) =>
        ch.name.startsWith("foundry-") && ch.name.endsWith(`-${userIdSuffix}`)
    );
  }

  if (channel) {
    console.log(`✅ Found existing channel: ${channel.name} (${channel.id})`);
    // Update our cache
    client.userChannels.set(userId, channel.id);
  } else {
    console.log(`❌ No channel found for ${username} (${userId})`);
    console.log(`Expected name: ${expectedChannelName}`);
    console.log(`Searched ${guild.channels.cache.size} channels`);
  }

  return channel;
}

// Helper function to invoke Lambda

// ================================================================================
// AWS LAMBDA OPERATIONS
// ================================================================================
async function invokeLambda(payload) {
  console.log(
    "Invoking Lambda with payload:",
    JSON.stringify(payload, null, 2)
  );

  const command = new InvokeCommand({
    FunctionName: process.env.LAMBDA_FUNCTION_NAME,
    Payload: JSON.stringify(payload),
    InvocationType: "RequestResponse",
  });

  try {
    const response = await lambda.send(command);

    if (response.FunctionError) {
      throw new Error(`Lambda function error: ${response.FunctionError}`);
    }

    const result = JSON.parse(new TextDecoder().decode(response.Payload));

    if (result.statusCode !== 200) {
      const errorBody =
        typeof result.body === "string" ? JSON.parse(result.body) : result.body;
      throw new Error(errorBody.error || "Unknown Lambda error");
    }

    return typeof result.body === "string"
      ? JSON.parse(result.body)
      : result.body;
  } catch (error) {
    console.error("Lambda invocation error:", error);
    throw error;
  }
}

async function getUserCostsWithSupporter(userId, guild) {
  try {
    // Get user's supporter amount
    let supporterAmount = 0;
    if (guild) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) {
        supporterAmount = getUserSupporterAmount(member);
      }
    }

    // Get base cost data from Lambda
    const costData = await invokeLambda({
      action: "get-user-costs",
      userId: userId,
    });

    // Apply supporter discount
    const supporterDiscount = supporterAmount;
    const adjustedUncoveredCost = Math.max(
      0,
      costData.uncoveredCost - supporterDiscount
    );

    return {
      ...costData,
      supporterAmount,
      supporterDiscount,
      adjustedUncoveredCost,
      isSupporter: supporterAmount > 0,
    };
  } catch (error) {
    console.error("Error getting user costs with supporter info:", error);
    throw error;
  }
}

// Helper functions for permissions and channels

// ================================================================================
// PERMISSION UTILITIES
// ================================================================================
function hasRequiredRole(member) {
  // Handle null member (DMs or missing member info)
  if (!member || !member.roles) return false;

  const allowedRoles = process.env.ALLOWED_ROLES?.split(",") || [];

  // Filter out empty strings and check if any real roles remain
  const validRoles = allowedRoles.filter((role) => role.trim() !== "");
  if (validRoles.length === 0) return true; // No roles required = allow everyone

  return validRoles.some((role) =>
    member.roles.cache.some(
      (memberRole) => memberRole.name.toLowerCase() === role.toLowerCase()
    )
  );
}

function hasAdminRole(member) {
  // Handle null member (DMs or missing member info)
  if (!member || !member.roles || !member.permissions) return false;

  // Check Discord's built-in Administrator permission first
  if (member.permissions.has("Administrator")) {
    return true;
  }

  // Then check custom admin roles
  const adminRoles = process.env.ADMIN_ROLES?.split(",") || ["Admin"];
  return adminRoles.some((role) =>
    member.roles.cache.some(
      (memberRole) => memberRole.name.toLowerCase() === role.toLowerCase()
    )
  );
}

async function createUserCommandChannel(guild, userId, username) {
  const channelName = `foundry-${username}-${userId.slice(-4)}`;

  // Prepare channel creation options
  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    topic: `Foundry VTT instance control for ${username} (ID: ${userId})`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: userId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      // Add admin permissions
      ...getAdminRoleOverwrites(guild),
    ],
  };

  // Add parent category if FOUNDRY_CATEGORY_ID is set
  if (
    process.env.FOUNDRY_CATEGORY_ID &&
    process.env.FOUNDRY_CATEGORY_ID.trim() !== ""
  ) {
    channelOptions.parent = process.env.FOUNDRY_CATEGORY_ID;
    console.log(
      `Creating channel in category: ${process.env.FOUNDRY_CATEGORY_ID}`
    );
  }

  try {
    const channel = await guild.channels.create(channelOptions);

    client.userChannels.set(userId, channel.id);

    // Send initial welcome message and status dashboard
    const welcomeEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🎲 Foundry VTT Control Channel")
      .setDescription(`<@${userId}>, this is your command channel.`)
      .addFields([
        {
          name: "Controls",
          value: "Use buttons below or `/foundry dashboard`",
          inline: false,
        },
      ])
      .setTimestamp();

    const initialActionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_status_${userId}`)
        .setLabel("Check Status")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄")
    );

    await channel.send({
      embeds: [welcomeEmbed],
      components: [initialActionRow],
    });

    return channel;
  } catch (error) {
    console.error("Error creating user channel:", error);

    if (error.code === 50013) {
      throw new Error(
        "❌ **Missing Permissions**: The bot needs the 'Manage Channels' permission to create your command channel. Please ask a server admin to grant this permission to the bot."
      );
    }

    throw new Error(`Failed to create command channel: ${error.message}`);
  }
}

function getAdminRoleOverwrites(guild) {
  const adminRoles = process.env.ADMIN_ROLES?.split(",") || ["Admin"];
  const overwrites = [];

  adminRoles.forEach((roleName) => {
    const role = guild.roles.cache.find(
      (r) => r.name.toLowerCase() === roleName.toLowerCase()
    );
    if (role) {
      overwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }
  });

  return overwrites;
}

async function safeChannelSend(
  channel,
  messageOptions,
  fallbackChannelCreation = null
) {
  try {
    // Check if the bot has permission to send messages in this channel
    if (channel.guild) {
      const botMember = await channel.guild.members.fetch(client.user.id);
      const permissions = channel.permissionsFor(botMember);

      if (!permissions.has(PermissionFlagsBits.SendMessages)) {
        console.error(
          `Bot lacks Send Messages permission in channel: ${channel.name} (${channel.id})`
        );
        throw new Error(
          `Missing permission to send messages in channel ${channel.name}`
        );
      }
    }

    return await channel.send(messageOptions);
  } catch (error) {
    console.error(`Error sending message to channel ${channel.id}:`, error);

    // If we have a fallback channel creation function and it's a permission error
    if (
      fallbackChannelCreation &&
      (error.code === 50001 || error.code === 50013)
    ) {
      console.log("Attempting to create new channel as fallback");
      const newChannel = await fallbackChannelCreation();
      return await newChannel.send(messageOptions);
    }

    throw error;
  }
}

async function deleteUserCommandChannel(guild, userId) {
  const channelId = client.userChannels.get(userId);
  if (channelId) {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (channel) {
        await channel.delete();
      }
      client.userChannels.delete(userId);
      client.userStatusMessages.delete(userId);
    } catch (error) {
      console.error("Error deleting user channel:", error);
    }
  }
}


// ================================================================================
// MONITORING AND STATUS
// ================================================================================
function startStatusMonitoring(userId, channelId) {
  // Clear any existing monitor
  stopStatusMonitoring(userId);

  const monitorInterval = setInterval(async () => {
    try {
      const channel = client.channels.cache.get(channelId);
      if (!channel) {
        stopStatusMonitoring(userId);
        return;
      }

      // Only monitor status in user command channels, not in DMs or other channels
      if (
        !channel.guild ||
        !channel.name ||
        !channel.name.startsWith("foundry-")
      ) {
        console.log(
          `Skipping status monitoring for non-command channel: ${
            channel.name || "DM"
          }`
        );
        stopStatusMonitoring(userId);
        return;
      }

      const result = await invokeLambda({
        action: "status",
        userId: userId,
      });

      if (result.status === "running") {
        // Instance is running, we can stop monitoring startup
        stopStatusMonitoring(userId);

        // Send final status and control panel
        await sendInstanceControlPanel(channel, userId, result);
        return;
      }

      // Send status update
      await sendStatusUpdate(channel, result);
    } catch (error) {
      console.error("Status monitoring error:", error);

      const channel = client.channels.cache.get(channelId);
      if (channel) {
        const errorEmbed = new EmbedBuilder()
          .setColor("#ff0000")
          .setTitle("❌ Status Check Failed")
          .setDescription(`Error checking status: ${error.message}`)
          .setTimestamp();

        await channel.send({ embeds: [errorEmbed] });
      }

      stopStatusMonitoring(userId);
    }
  }, 10000); // Check every 10 seconds for faster detection

  client.statusMonitors.set(userId, monitorInterval);
}

function stopStatusMonitoring(userId) {
  const interval = client.statusMonitors.get(userId);
  if (interval) {
    clearInterval(interval);
    client.statusMonitors.delete(userId);
  }
}

async function sendStatusUpdate(channel, status) {
  return await sendUnifiedDashboard(channel, status.userId, status, "status");
}

async function sendInstanceControlPanel(channel, userId, status) {
  return await sendUnifiedDashboard(channel, userId, status, "running");
}

// Helper function to sync all running instances on bot startup
async function syncAllInstances() {
  console.log("🔄 Syncing all instances on startup...");

  try {
    // Get all instances from Lambda
    const result = await invokeLambda({
      action: "list-all",
      userId: "system", // System call
    });

    console.log(`Found ${result.count} total instances`);

    for (const instance of result.instances) {
      try {
        // Find the guild (assuming single guild, modify if multi-guild)
        const guild = client.guilds.cache.first();
        if (!guild) continue;

        // Try to find user and their command channel
        const user = await client.users
          .fetch(instance.userId)
          .catch(() => null);
        if (!user) {
          console.log(`User ${instance.userId} not found, skipping...`);
          continue;
        }

        // Find existing command channel
        const channel = await findExistingCommandChannel(
          guild,
          instance.userId,
          user.username
        );

        if (channel) {
          // Update our cache
          client.userChannels.set(instance.userId, channel.id);

          // Clear ALL messages from the command channel for visibility
          await clearChannelMessages(channel);

          // Clear stored message ID since we cleared the channel
          client.userStatusMessages.delete(instance.userId);

          // Get license owner info for pooled instances
          let licenseOwnerInfo = null;
          if (instance.licenseType === "pooled" && instance.licenseOwnerId) {
            try {
              const adminResult = await invokeLambda({
                action: "admin-overview",
                userId: instance.userId,
              });

              if (adminResult.licenses && adminResult.licenses.pools) {
                const licensePool = adminResult.licenses.pools.find(
                  (pool) => pool.licenseId === instance.licenseOwnerId
                );
                if (licensePool) {
                  licenseOwnerInfo = licensePool.ownerUsername;
                }
              }
            } catch (error) {
              console.log("Could not fetch license owner info for sync");
            }
          }

          // Determine license display - be more careful with missing data
          let licenseDisplay;
          const licenseType = instance.licenseType;

          // Debug logging for license type detection
          console.log(`🔍 License Debug for ${instance.sanitizedUsername}:`, {
            licenseType: instance.licenseType,
            licenseOwnerId: instance.licenseOwnerId,
            allowLicenseSharing: instance.allowLicenseSharing,
            userId: instance.userId,
            expectedByolId: `byol-${instance.userId}`,
          });

          if (!licenseType) {
            // Handle missing license type - check other indicators
            if (
              instance.licenseOwnerId &&
              instance.licenseOwnerId !== `byol-${instance.userId}`
            ) {
              // Has a license owner that's not themselves = pooled instance
              console.log(
                `✅ Detected as pooled instance (no licenseType but has different licenseOwnerId)`
              );
              licenseDisplay = licenseOwnerInfo
                ? `🌐 Pooled (${licenseOwnerInfo}'s License)`
                : "🌐 Pooled - Smart License Assignment";
            } else {
              // Default to BYOL for missing data
              console.log(
                `⚠️ Defaulting to BYOL (missing licenseType, no different licenseOwnerId)`
              );
              licenseDisplay = instance.allowLicenseSharing
                ? "🤝 BYOL - Sharing with Community"
                : "🔐 BYOL - Private License";
            }
          } else if (licenseType === "byol") {
            console.log(`✅ Confirmed BYOL license type`);
            licenseDisplay = instance.allowLicenseSharing
              ? "🤝 BYOL - Sharing with Community"
              : "🔐 BYOL - Private License";
          } else if (licenseType === "pooled") {
            console.log(`✅ Confirmed pooled license type`);
            licenseDisplay = licenseOwnerInfo
              ? `🌐 Pooled (${licenseOwnerInfo}'s License)`
              : "🌐 Pooled - Smart License Assignment";
          } else {
            // Unknown license type
            console.log(`❓ Unknown license type: ${licenseType}`);
            licenseDisplay = `❔ Unknown License Type: ${licenseType}`;
          }
          // Use unified dashboard for all instances
          await sendUnifiedDashboard(
            channel,
            instance.userId,
            instance,
            "sync"
          );

          console.log(
            `✅ Synced ${user.username}'s instance (${instance.status})`
          );
        } else {
          console.log(
            `No command channel found for ${user.username}, will create on next interaction`
          );
        }
      } catch (error) {
        console.error(
          `Error syncing instance for user ${instance.userId}:`,
          error.message
        );
      }
    }

    console.log("✅ Instance synchronization complete");
  } catch (error) {
    console.error("❌ Failed to sync instances on startup:", error.message);
  }
}


// ================================================================================
// BOT EVENTS AND INITIALIZATION
// ================================================================================
// Bot ready event
client.once("ready", async () => {
  console.log(`✅ Foundry VTT Bot is ready! Logged in as ${client.user.tag}`);
  console.log(`📋 Registered in ${client.guilds.cache.size} servers`);

  client.user.setActivity("Foundry VTT instances", { type: "WATCHING" });

  // Setup logging channel
  await setupLoggingChannel();

  // Clean up any orphaned status monitors on restart
  client.statusMonitors.clear();

  // Restore and validate registration stats mapping from DB
  if (botConfigTableName) {
    const mapping = await loadRegistrationStatsMappingFromDB();
    if (mapping && mapping.channelId && mapping.messageId) {
      console.log(
        `🔍 Found registration stats mapping: ${mapping.channelId} -> ${mapping.messageId}`
      );

      // Validate the mapping exists
      try {
        const channel = await client.channels.fetch(mapping.channelId);
        if (channel) {
          const message = await channel.messages.fetch(mapping.messageId);
          if (message) {
            client.registrationStats.set(mapping.channelId, mapping.messageId);
            console.log(
              "✅ Validated and restored registration stats mapping from DynamoDB"
            );
          } else {
            console.log(
              "⚠️ Registration stats message not found, will clean up on first refresh"
            );
          }
        } else {
          console.log(
            "⚠️ Registration stats channel not found, will clean up on first refresh"
          );
        }
      } catch (error) {
        console.log(
          `⚠️ Error validating registration stats mapping: ${error.message}, will clean up on first refresh`
        );
      }
    } else {
      console.log("ℹ️ No registration stats mapping found in DynamoDB");
    }
  }

  // Restore and validate admin status mapping
  if (botConfigTableName) {
    const adminMap = await loadAdminStatusMappingFromDB();
    console.log("🔍 Admin status mapping from DB:", adminMap);
    if (adminMap && adminMap.channelId && adminMap.messageId) {
      console.log(
        `🔍 Found admin status mapping: ${adminMap.channelId} -> ${adminMap.messageId}`
      );

      // Validate the mapping exists
      try {
        const channel = await client.channels.fetch(adminMap.channelId);
        if (channel) {
          const message = await channel.messages.fetch(adminMap.messageId);
          if (message) {
            client.adminStatusMapping.set(
              adminMap.channelId,
              adminMap.messageId
            );
            console.log(
              "✅ Validated and restored admin status mapping from DynamoDB"
            );
          } else {
            console.log(
              "⚠️ Admin status message not found, will clean up on first refresh"
            );
          }
        } else {
          console.log(
            "⚠️ Admin status channel not found, will clean up on first refresh"
          );
        }
      } catch (error) {
        console.log(
          `⚠️ Error validating admin status mapping: ${error.message}, will clean up on first refresh`
        );
      }
    } else {
      console.log("ℹ️ No admin status mapping found in DynamoDB");
    }
  } else {
    console.log(
      "⚠️ BOT_CONFIG_TABLE_NAME not set, cannot restore admin status mapping"
    );
  }

  // Sync all running instances
  await syncAllInstances();

  // Refresh statistics and admin status after startup
  try {
    await refreshRegistrationStats();
    console.log("✅ Refreshed registration statistics on startup");
  } catch (error) {
    console.log(
      "⚠️ Failed to refresh registration stats on startup:",
      error.message
    );
  }

  try {
    await refreshAdminStatus();
    console.log("✅ Refreshed admin status dashboard on startup");
  } catch (error) {
    console.log("⚠️ Failed to refresh admin status on startup:", error.message);
  }

  // Set up periodic cleanup of invalid mappings (every 6 hours)
  cron.schedule("0 */6 * * *", async () => {
    console.log("🧹 Running periodic cleanup of invalid message mappings...");
    try {
      await refreshRegistrationStats();
      await refreshAdminStatus();
      console.log("✅ Periodic cleanup completed");
    } catch (error) {
      console.error("❌ Periodic cleanup failed:", error.message);
    }
  });

  console.log("⏰ Scheduled periodic cleanup every 6 hours");
});

// Error handling
client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});


// ================================================================================
// INTERACTION HANDLERS
// ================================================================================
// Interaction handling
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
  } else if (interaction.isButton()) {
    // Check if it's an admin button
    if (interaction.customId.startsWith("admin_")) {
      await handleAdminButtonInteraction(interaction);
    } else {
      await handleButtonInteraction(interaction);
    }
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenuInteraction(interaction);
  } else if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
  }
});


// ================================================================================
// COMMAND HANDLERS
// ================================================================================
async function handleSlashCommand(interaction) {
  // Skip role check for DMs (no guild member context)
  if (interaction.guild && !hasRequiredRole(interaction.member)) {
    return await interaction.reply({
      content: "❌ You do not have permission to use Foundry commands.",
      ephemeral: true,
    });
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    interaction.invokeLambda = invokeLambda;
    interaction.sendUnifiedDashboard = sendUnifiedDashboard;
    interaction.hasAdminRole = () =>
      interaction.guild ? hasAdminRole(interaction.member) : false;
    interaction.createUserCommandChannel = (userId, username) =>
      createUserCommandChannel(interaction.guild, userId, username);
    interaction.deleteUserCommandChannel = (userId) =>
      deleteUserCommandChannel(interaction.guild, userId);
    interaction.startStatusMonitoring = startStatusMonitoring;
    interaction.addRegistrationStatsMapping = async (channelId, messageId) => {
      client.registrationStats.set(channelId, messageId);
      const saved = await saveRegistrationStatsMappingToDB(
        channelId,
        messageId
      );
      if (!saved) {
        console.error(
          "⚠️ Failed to save registration stats mapping to DynamoDB - mappings will not persist across restarts"
        );
      }
      return saved;
    };
    interaction.addAdminStatusMapping = async (channelId, messageId) => {
      client.adminStatusMapping.set(channelId, messageId);
      const saved = await saveAdminStatusMappingToDB(channelId, messageId);
      if (!saved) {
        console.error(
          "⚠️ Failed to save admin status mapping to DynamoDB - mappings will not persist across restarts"
        );
      }
      return saved;
    };

    await command.execute(interaction);
  } catch (error) {
    console.error("Command execution error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Error")
      .setDescription(`An error occurred: ${error.message}`)
      .setTimestamp();

    const errorMessage = { embeds: [errorEmbed], ephemeral: true };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
}


// ================================================================================
// BUTTON INTERACTION HANDLERS
// ================================================================================
async function handleButtonInteraction(interaction) {
  const parts = interaction.customId.split("_");
  const [action, subAction] = parts;

  if (action !== "foundry") return;

  // Handle different button ID formats
  let userId, confirmAction;

  if (parts.length === 2 && subAction === "register") {
    // Format: foundry_register (generic registration button)
    userId = interaction.user.id;
  } else if (parts.length === 3) {
    // Format: foundry_action_userId
    userId = parts[2];
  } else if (parts.length === 4) {
    // Format: foundry_action_confirm_userId or special actions
    if (
      subAction === "reregister" ||
      subAction === "use" ||
      subAction === "create" ||
      subAction === "destroy"
    ) {
      // Format: foundry_reregister_byol_userId, foundry_use_pooled_userId, foundry_create_pooled_userId
      userId = parts[3];
      confirmAction = `${subAction}_${parts[2]}`;
    } else if (subAction === "stop") {
      // Format: foundry_stop_restart_userId, foundry_stop_cancel_userId
      userId = parts[3];
      confirmAction = `${subAction}_${parts[2]}`;
    } else {
      confirmAction = parts[2];
      userId = parts[3];
    }
  } else if (parts.length === 5) {
    // Format: foundry_action_part1_part2_userId (5-part special actions)
    if (subAction === "destroy") {
      // Format: foundry_destroy_keep_sharing_userId, foundry_destroy_stop_sharing_userId
      userId = parts[4];
      confirmAction = `${subAction}_${parts[2]}_${parts[3]}`;
    } else if (subAction === "stop") {
      // Format: foundry_stop_cancel_session_userId
      userId = parts[4];
      confirmAction = `${subAction}_${parts[2]}_${parts[3]}`;
    } else {
      return;
    }
  } else {
    return;
  }

  // Handle buttons that need special interaction handling (modals or updates to existing interactions)
  if (subAction === "register") {
    try {
      await handleRegisterButton(interaction, userId);
      return;
    } catch (error) {
      console.error("Registration button error:", error);
      return await interaction.reply({
        content: `❌ Registration failed: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (subAction === "schedule") {
    // Check if user can interact with this button (skip admin check for DMs)
    if (
      userId !== interaction.user.id &&
      interaction.guild &&
      !hasAdminRole(interaction.member)
    ) {
      return await interaction.reply({
        content: "❌ You can only control your own instance.",
        ephemeral: true,
      });
    }

    try {
      await handleScheduleButton(interaction, userId);
      return;
    } catch (error) {
      console.error("Schedule button error:", error);
      return await interaction.reply({
        content: `❌ Schedule failed: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  // Handle license sharing buttons
  if (subAction === "start" && parts[2] === "sharing") {
    try {
      await handleStartLicenseSharing(interaction, userId);
      return;
    } catch (error) {
      console.error("Start license sharing error:", error);
      return await interaction.reply({
        content: `❌ Failed to start license sharing: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (subAction === "stop" && parts[2] === "sharing") {
    try {
      await handleStopLicenseSharing(interaction, userId);
      return;
    } catch (error) {
      console.error("Stop license sharing error:", error);
      return await interaction.reply({
        content: `❌ Failed to stop license sharing: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  // Handle the new stop sharing options
  if (subAction === "stop" && parts[2] === "sharing" && parts[3] === "now") {
    try {
      await performStopLicenseSharing(interaction, userId, "immediate");
      return;
    } catch (error) {
      console.error("Stop sharing now error:", error);
      return await interaction.reply({
        content: `❌ Failed to stop license sharing: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (
    subAction === "stop" &&
    parts[2] === "sharing" &&
    parts[3] === "after" &&
    parts[4] === "sessions"
  ) {
    try {
      await performStopLicenseSharing(interaction, userId, "after_sessions");
      return;
    } catch (error) {
      console.error("Stop sharing after sessions error:", error);
      return await interaction.reply({
        content: `❌ Failed to schedule license sharing stop: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (subAction === "stop" && parts[2] === "sharing" && parts[3] === "cancel") {
    try {
      await handleLicenseSharingCancel(interaction, userId);
      return;
    } catch (error) {
      console.error("Stop sharing cancel error:", error);
      return await interaction.reply({
        content: `❌ Failed to cancel: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  // Handle license sharing management button from channel
  if (subAction === "license" && parts[2] === "sharing") {
    try {
      // This will trigger the license sharing management flow
      await handleLicenseSharing(interaction, userId);
      return;
    } catch (error) {
      console.error("License sharing management error:", error);
      return await interaction.reply({
        content: `❌ Failed to open license sharing management: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (
    subAction === "license" &&
    parts[2] === "sharing" &&
    parts[3] === "cancel"
  ) {
    try {
      await handleLicenseSharingCancel(interaction, userId);
      return;
    } catch (error) {
      console.error("License sharing cancel error:", error);
      return await interaction.reply({
        content: `❌ Failed to cancel: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  // Handle special registration action buttons (these update existing interactions)
  if (confirmAction === "reregister_byol") {
    try {
      await handleReregisterBYOL(interaction, userId);
      return;
    } catch (error) {
      console.error("Re-register BYOL error:", error);
      return await interaction.reply({
        content: `❌ Re-registration failed: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (confirmAction === "stop_sharing") {
    try {
      await handleStopSharing(interaction, userId);
      return;
    } catch (error) {
      console.error("Stop sharing error:", error);
      return await interaction.reply({
        content: `❌ Failed to stop sharing: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (confirmAction === "use_pooled") {
    try {
      await handleCreatePooledAutomatic(interaction, userId);
      return;
    } catch (error) {
      console.error("Use pooled error:", error);
      return await interaction.reply({
        content: `❌ Failed to use pooled license: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (confirmAction === "destroy_keep_sharing") {
    try {
      await handleDestroyKeepSharing(interaction, userId);
      return;
    } catch (error) {
      console.error("Destroy keep sharing error:", error);
      return await interaction.reply({
        content: `❌ Failed to destroy instance: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (confirmAction === "destroy_stop_sharing") {
    try {
      await handleDestroyStopSharing(interaction, userId);
      return;
    } catch (error) {
      console.error("Destroy stop sharing error:", error);
      return await interaction.reply({
        content: `❌ Failed to destroy instance: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (confirmAction === "stop_cancel_session") {
    try {
      await handleStopCancelSession(interaction, userId);
      return;
    } catch (error) {
      console.error("Stop cancel session error:", error);
      return await interaction.reply({
        content: `❌ Failed to stop and cancel session: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (confirmAction === "stop_restart") {
    try {
      await handleStopRestart(interaction, userId);
      return;
    } catch (error) {
      console.error("Stop restart error:", error);
      return await interaction.reply({
        content: `❌ Failed to stop and restart: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  if (confirmAction === "stop_cancel") {
    try {
      await handleStopCancel(interaction, userId);
      return;
    } catch (error) {
      console.error("Stop cancel error:", error);
      return await interaction.reply({
        content: `❌ Failed to cancel stop: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  // Check if user can interact with this button (skip admin check for DMs)
  if (
    userId !== interaction.user.id &&
    interaction.guild &&
    !hasAdminRole(interaction.member)
  ) {
    return await interaction.reply({
      content: "❌ You can only control your own instance.",
      ephemeral: true,
    });
  }

  await interaction.deferReply();

  try {
    switch (subAction) {
      case "start":
        await handleStartButton(interaction, userId);
        break;
      case "stop":
        await handleStopButton(interaction, userId);
        break;
      case "status":
        await handleStatusButton(interaction, userId);
        break;
      case "adminkey":
        await handleAdminKeyButton(interaction, userId);
        break;
      case "destroy":
        if (confirmAction === "destroy_confirm") {
          await handleDestroyConfirmButton(interaction, userId);
        } else if (confirmAction === "destroy_cancel") {
          await handleDestroyCancelButton(interaction, userId);
        } else if (confirmAction === "destroy_keep_sharing") {
          await handleDestroyKeepSharing(interaction, userId);
        } else if (confirmAction === "destroy_stop_sharing") {
          await handleDestroyStopSharing(interaction, userId);
        } else {
          await handleDestroyButton(interaction, userId);
        }
        break;
      case "sessions":
        await handleSessionsButton(interaction, userId);
        break;
      default:
        await interaction.editReply({ content: "❌ Unknown button action." });
    }
  } catch (error) {
    console.error("Button interaction error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Error")
      .setDescription(`An error occurred: ${error.message}`)
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleRegisterButton(interaction, userId) {
  // Prevent instance creation in DMs - must be done in server
  if (!interaction.guild) {
    return await interaction.reply({
      content: [
        "❌ **Instance creation must be done in the server**",
        "",
        "Please use the `/foundry dashboard` command in the server to register your instance.",
        "",
        "This ensures proper role verification and channel creation.",
      ].join("\n"),
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // Check if user already has a license pool (destroyed instance but still sharing)
  try {
    const adminResult = await invokeLambda({
      action: "admin-overview",
      userId: userId,
    });

    if (!adminResult.licenses || !adminResult.licenses.pools) {
      console.log("No license pools data returned from admin-overview");
      throw new Error("Could not fetch license pools");
    }

    const userLicensePool = adminResult.licenses.pools.find(
      (pool) => pool.ownerId === userId
    );

    console.log(
      `Checking for existing license pool for user ${userId}: ${
        userLicensePool ? "Found" : "Not found"
      }`
    );

    if (userLicensePool) {
      // User has an active license pool but no instance
      const embed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle("🔄 Existing License Pool Detected")
        .setDescription(
          "You currently have an active license pool that others can use, but no instance of your own."
        )
        .addFields([
          {
            name: "Your Shared License",
            value: `**${userLicensePool.ownerUsername}**\nMax Users: ${
              userLicensePool.maxConcurrentUsers
            }\nStatus: ${
              userLicensePool.isActive ? "🟢 Active" : "🔴 Inactive"
            }`,
            inline: false,
          },
          {
            name: "Choose Action",
            value:
              "• **Re-register Instance**: Create a new BYOL instance with full control\n• **Use Pooled License**: Create an instance with automatic license assignment (will prioritize your own license)\n• **Stop License Sharing**: Remove your license from the pool and start fresh",
            inline: false,
          },
        ]);

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_reregister_byol_${userId}`)
          .setLabel("Re-register My Instance")
          .setStyle(ButtonStyle.Success)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_use_pooled_${userId}`)
          .setLabel("Use Pooled License")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🌐"),
        new ButtonBuilder()
          .setCustomId(`foundry_stop_sharing_${userId}`)
          .setLabel("Stop License Sharing")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🛑")
      );

      return await interaction.editReply({
        embeds: [embed],
        components: [actionRow],
      });
    }
  } catch (error) {
    // If we can't check license pools, continue with normal flow
    console.log("Could not check license pools, continuing with normal flow");
  }

  // Normal registration flow - check available license pools for pooled option
  let availablePools = [];
  try {
    const poolsResult = await invokeLambda({
      action: "admin-overview",
      userId: userId,
    });
    availablePools = poolsResult.licenses.pools.filter((pool) => pool.isActive);
  } catch (error) {
    console.log("Could not fetch license pools");
  }

  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("🔑 Choose Your License Type")
    .setDescription("Select how you want to use Foundry VTT:")
    .addFields([
      {
        name: "🔐 BYOL (Bring Your Own License)",
        value:
          "• Use your own Foundry license\n• Start instances on-demand\n• Can pool your license with community\n• Full control over your instance",
        inline: false,
      },
      {
        name: "🌐 Shared Instance (Community License)",
        value:
          availablePools.length > 0
            ? `• Use community-shared licenses\n• Schedule-based access (no on-demand)\n• **Prioritizes your own license if pooled**\n• **${availablePools.length} license pool(s) available**`
            : "• Use community-shared licenses\n• Schedule-based access (no on-demand)\n• **Prioritizes your own license if pooled**\n• ⚠️ **No license pools currently available**",
        inline: false,
      },
    ])
    .setFooter({
      text: "💡 Tip: Licenses can be pooled, instances are shared. Choose your preferred option below.",
    });

  const selectOptions = [
    {
      label: "BYOL - Own License",
      description: "I have my own Foundry license and want on-demand access",
      value: "byol_no_share",
      emoji: "🔐",
    },
    {
      label: "BYOL - Own License + Pool",
      description:
        "I have my own license and want to pool it with the community",
      value: "byol_share",
      emoji: "🤝",
    },
  ];

  // Add shared instance option if license pools are available
  if (availablePools.length > 0) {
    selectOptions.push({
      label: "Shared Instance - Community License",
      description: `Use one of ${availablePools.length} available license pools`,
      value: "pooled",
      emoji: "🌐",
    });
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`foundry_license_select_${userId}`)
    .setPlaceholder("Select your license type...")
    .addOptions(selectOptions);

  const actionRow = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.editReply({
    embeds: [embed],
    components: [actionRow],
  });
}

async function handleAdminButtonInteraction(interaction) {
  const customId = interaction.customId;

  // Check admin permissions
  const isAdmin = hasAdminRole(interaction.member);

  if (!isAdmin) {
    await interaction.reply({
      content: "❌ Admin access required.",
      ephemeral: true,
    });
    return;
  }

  if (customId === "admin_refresh_status") {
    await interaction.deferUpdate();

    // Re-execute the admin-status command to refresh
    try {
      const adminCommand = require("./commands/admin");
      // Create a mock interaction for the command execution
      const mockInteraction = {
        ...interaction,
        deferReply: () => Promise.resolve(),
        editReply: interaction.editReply.bind(interaction),
        user: interaction.user,
        member: interaction.member,
      };
      await adminCommand.execute(mockInteraction);
    } catch (error) {
      console.error("Admin refresh error:", error);
      await interaction.editReply({
        content: `❌ Error refreshing status: ${error.message}`,
      });
    }
  } else if (customId === "admin_detailed_view") {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get detailed admin overview
      const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME,
        Payload: JSON.stringify({
          action: "admin-overview",
          userId: interaction.user.id,
        }),
      });

      const result = await lambda.send(command);
      const response = JSON.parse(new TextDecoder().decode(result.Payload));

      if (response.statusCode !== 200) {
        throw new Error(JSON.parse(response.body).error);
      }

      const data = JSON.parse(response.body);

      // Create detailed embeds
      const detailedEmbed = new EmbedBuilder()
        .setTitle("📋 Detailed System Information")
        .setColor(0x0099ff)
        .setTimestamp();

      // All running instances
      if (data.instances.running.length > 0) {
        const detailedRunning = data.instances.running
          .map((instance) => {
            const autoShutdown = instance.autoShutdownAt
              ? ` | Shuts down <t:${instance.autoShutdownAt}:R>`
              : "";
            const session = instance.linkedSessionId
              ? ` | Session: ${instance.linkedSessionId}`
              : "";
            const startedTime = instance.startedAt
              ? ` | Started <t:${instance.startedAt}:R>`
              : "";
            return `**${instance.username}** (${
              instance.userId
            })\n${instance.licenseType?.toUpperCase()} | v${
              instance.foundryVersion
            }${startedTime}${session}${autoShutdown}`;
          })
          .join("\n\n");

        detailedEmbed.addFields([
          {
            name: `🚀 All Running Instances (${data.instances.running.length})`,
            value:
              detailedRunning.length > 1024
                ? detailedRunning.substring(0, 1020) + "..."
                : detailedRunning,
            inline: false,
          },
        ]);
      }

      // All stopped instances
      if (data.instances.stopped.length > 0) {
        const stoppedList = data.instances.stopped
          .slice(0, 10) // Limit to prevent embed overflow
          .map((instance) => {
            return `**${
              instance.username
            }** (${instance.licenseType?.toUpperCase()}) - <t:${
              instance.updatedAt
            }:R>`;
          })
          .join("\n");

        const moreStopped =
          data.instances.stopped.length > 10
            ? `\n*+${data.instances.stopped.length - 10} more...*`
            : "";

        detailedEmbed.addFields([
          {
            name: `💤 Stopped Instances (${data.instances.stopped.length})`,
            value: stoppedList + moreStopped,
            inline: false,
          },
        ]);
      }

      // All sessions detail
      if (
        data.sessions.active.length > 0 ||
        data.sessions.upcoming.length > 0
      ) {
        let sessionsDetail = "";

        if (data.sessions.active.length > 0) {
          sessionsDetail += "**🎮 Active Sessions:**\n";
          sessionsDetail +=
            data.sessions.active
              .map((session) => {
                return `${session.title || "Session"} - ${
                  session.username
                } | Ends <t:${session.endTime}:R>`;
              })
              .join("\n") + "\n\n";
        }

        if (data.sessions.upcoming.length > 0) {
          sessionsDetail += "**📅 Upcoming Sessions:**\n";
          sessionsDetail += data.sessions.upcoming
            .slice(0, 5)
            .map((session) => {
              return `${session.title || "Session"} - ${
                session.username
              } | <t:${session.startTime}:R>`;
            })
            .join("\n");
        }

        detailedEmbed.addFields([
          {
            name: "🎮 Session Details",
            value:
              sessionsDetail.length > 1024
                ? sessionsDetail.substring(0, 1020) + "..."
                : sessionsDetail,
            inline: false,
          },
        ]);
      }

      await interaction.editReply({ embeds: [detailedEmbed] });
    } catch (error) {
      console.error("Detailed view error:", error);
      await interaction.editReply({
        content: `❌ Error getting detailed view: ${error.message}`,
      });
    }
  } else if (customId === "admin_emergency_actions") {
    const emergencyEmbed = new EmbedBuilder()
      .setTitle("🚨 Emergency Administrative Actions")
      .setDescription(
        "**Warning:** These actions will immediately affect running instances and sessions."
      )
      .setColor(0xff0000);

    const emergencyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_shutdown_all")
        .setLabel("🛑 Shutdown All Instances")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("admin_cancel_all_sessions")
        .setLabel("❌ Cancel All Sessions")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("admin_system_maintenance")
        .setLabel("🔧 Maintenance Mode")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("admin_maintenance_reset")
        .setLabel("🔄 Reset Sessions & Re-activate Licenses")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [emergencyEmbed],
      components: [emergencyRow],
      ephemeral: true,
    });
  } else if (customId === "admin_shutdown_all") {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get all running instances first
      const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME,
        Payload: JSON.stringify({
          action: "admin-overview",
          userId: interaction.user.id,
        }),
      });

      const result = await lambda.send(command);
      const response = JSON.parse(new TextDecoder().decode(result.Payload));

      if (response.statusCode !== 200) {
        throw new Error(JSON.parse(response.body).error);
      }

      const data = JSON.parse(response.body);
      const runningInstances = data.instances.running;

      if (runningInstances.length === 0) {
        await interaction.editReply({
          content: "ℹ️ No running instances to shutdown.",
        });
        return;
      }

      // Shutdown all running instances
      let shutdownCount = 0;
      const errors = [];

      for (const instance of runningInstances) {
        try {
          const shutdownCommand = new InvokeCommand({
            FunctionName: process.env.LAMBDA_FUNCTION_NAME,
            Payload: JSON.stringify({
              action: "admin-force-shutdown",
              userId: interaction.user.id,
              targetUserId: instance.userId,
              forceReason: "Admin emergency shutdown - all instances",
            }),
          });

          await lambda.send(shutdownCommand);
          shutdownCount++;
        } catch (error) {
          errors.push(`${instance.username}: ${error.message}`);
        }
      }

      const resultMessage = [
        `✅ **Emergency Shutdown Complete**`,
        `**Instances Shutdown:** ${shutdownCount}/${runningInstances.length}`,
        errors.length > 0 ? `**Errors:** ${errors.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      await interaction.editReply({
        content: resultMessage,
      });
    } catch (error) {
      console.error("Admin shutdown all error:", error);
      await interaction.editReply({
        content: `❌ Error during emergency shutdown: ${error.message}`,
      });
    }
  } else if (customId === "admin_cancel_all_sessions") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME,
        Payload: JSON.stringify({
          action: "admin-cancel-all-sessions",
          userId: interaction.user.id,
          forceReason: "Admin emergency cancellation - all sessions",
        }),
      });

      const result = await lambda.send(command);
      const response = JSON.parse(new TextDecoder().decode(result.Payload));

      if (response.statusCode !== 200) {
        throw new Error(JSON.parse(response.body).error);
      }

      const data = JSON.parse(response.body);

      const resultMessage = [
        `✅ **Emergency Session Cancellation Complete**`,
        `**Sessions Cancelled:** ${data.cancelledCount}/${data.totalSessions}`,
        data.errors && data.errors.length > 0
          ? `**Errors:** ${data.errors.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      await interaction.editReply({
        content: resultMessage,
      });
    } catch (error) {
      console.error("Admin cancel all sessions error:", error);
      await interaction.editReply({
        content: `❌ Error during emergency session cancellation: ${error.message}`,
      });
    }
  } else if (customId === "admin_system_maintenance") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME,
        Payload: JSON.stringify({
          action: "admin-system-maintenance",
          userId: interaction.user.id,
          forceReason: "Admin maintenance mode activation",
        }),
      });

      const result = await lambda.send(command);
      const response = JSON.parse(new TextDecoder().decode(result.Payload));

      if (response.statusCode !== 200) {
        throw new Error(JSON.parse(response.body).error);
      }

      const data = JSON.parse(response.body);

      const resultMessage = [
        `🔧 **System Maintenance Mode Activated**`,
        `**Instances Shutdown:** ${data.shutdownCount}/${data.totalInstances}`,
        `**Sessions Cancelled:** ${data.cancelledCount}/${data.totalSessions}`,
        data.errors && data.errors.length > 0
          ? `**Errors:** ${data.errors.join(", ")}`
          : "",
        ``,
        `⚠️ **All services are now offline for maintenance**`,
      ]
        .filter(Boolean)
        .join("\n");

      await interaction.editReply({
        content: resultMessage,
      });
    } catch (error) {
      console.error("Admin system maintenance error:", error);
      await interaction.editReply({
        content: `❌ Error activating maintenance mode: ${error.message}`,
      });
    }
  } else if (customId === "admin_maintenance_reset") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME,
        Payload: JSON.stringify({
          action: "admin-maintenance-reset",
          userId: interaction.user.id,
          forceReason: "Admin maintenance reset - sessions and licenses",
        }),
      });

      const result = await lambda.send(command);
      const response = JSON.parse(new TextDecoder().decode(result.Payload));

      if (response.statusCode !== 200) {
        throw new Error(JSON.parse(response.body).error);
      }

      const data = JSON.parse(response.body);

      const resultMessage = [
        `🔄 **Maintenance Reset Completed**`,
        `**Sessions Cancelled:** ${data.cancelledCount}/${data.totalSessions}`,
        `**License Reservations Cleared:** ${data.reservationsCancelled || 0}`,
        `**License Pools Reset & Re-activated:** ${data.resetCount}/${data.totalLicensePools}`,
        data.errors && data.errors.length > 0
          ? `**Errors:** ${data.errors.join(", ")}`
          : "",
        ``,
        `✅ **All scheduled sessions cancelled**`,
        `✅ **All license reservations cleared**`,
        `✅ **License pools reset and re-activated for new sessions**`,
        `⚠️ **Instances remain running - use "Shutdown All Instances" if needed**`,
      ]
        .filter(Boolean)
        .join("\n");

      await interaction.editReply({
        content: resultMessage,
      });
    } catch (error) {
      console.error("Admin maintenance reset error:", error);
      await interaction.editReply({
        content: `❌ Error during maintenance reset: ${error.message}`,
      });
    }
  } else {
    await interaction.reply({
      content: "❌ Unknown admin action.",
      ephemeral: true,
    });
  }
}


// ================================================================================
// MODAL HANDLERS
// ================================================================================
async function handleModalSubmit(interaction) {
  if (interaction.customId.startsWith("foundry_credentials_")) {
    await handleCredentialsModal(interaction);
  } else if (interaction.customId.startsWith("foundry_schedule_modal_")) {
    await handleScheduleModal(interaction);
  }
}

async function handleCredentialsModal(interaction) {
  // Prevent instance creation in DMs - must be done in server
  if (!interaction.guild) {
    return await interaction.reply({
      content: [
        "❌ **Instance creation must be done in the server**",
        "",
        "Please use the `/foundry dashboard` command in the server to register your instance.",
        "",
        "This ensures proper role verification and channel creation.",
      ].join("\n"),
      ephemeral: true,
    });
  }

  const modalIdParts = interaction.customId.split("_");
  const userId = modalIdParts[2];
  const licenseType = modalIdParts[3];
  const allowLicenseSharing = modalIdParts[4] === "true";

  // Verify this is the correct user
  if (userId !== interaction.user.id) {
    return await interaction.reply({
      content: "❌ You can only register your own instance.",
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Show immediate feedback that process has started
    await interaction.editReply({
      content:
        "🔄 **Creating your instance...**\n\nThis takes a few moments. Please wait...",
    });

    const username = interaction.fields.getTextInputValue("foundry_username");
    const password = interaction.fields.getTextInputValue("foundry_password");

    const user = await client.users.fetch(userId);
    const sanitizedUsername = sanitizeUsername(user.username);

    const result = await invokeLambda({
      action: "create",
      userId: userId,
      sanitizedUsername: sanitizedUsername,
      foundryUsername: username,
      foundryPassword: password,
      licenseType: licenseType,
      allowLicenseSharing: allowLicenseSharing,
      maxConcurrentUsers: 1, // Default to 1 concurrent user
    });

    // Create user command channel
    const channel = await createUserCommandChannel(
      interaction.guild,
      userId,
      user.username
    );

    // Determine license display text
    const licenseDisplay =
      licenseType === "byol"
        ? allowLicenseSharing
          ? "🤝 BYOL - Sharing with Community"
          : "🔐 BYOL - Private License"
        : "🌐 Pooled - Using Shared License";

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("✅ Instance Created")
      .setDescription(`Command channel: ${channel}`)
      .addFields([
        { name: "Status", value: "⚪ Created", inline: true },
        {
          name: "License Type",
          value: licenseDisplay,
          inline: true,
        },
        {
          name: "Your URL",
          value: result.url || "Available after startup",
          inline: false,
        },
        {
          name: "Foundry Version",
          value: `\`felddy/foundryvtt:13\` (v13 - Latest Stable)`,
          inline: true,
        },
        {
          name: "S3 Assets",
          value: result.s3BucketUrl
            ? `[Your S3 Bucket](${result.s3BucketUrl})`
            : "S3 bucket created",
          inline: true,
        },
        {
          name: "Next Step",
          value:
            licenseType === "byol"
              ? allowLicenseSharing
                ? 'Click "Start Instance" for on-demand access, or "Schedule Session" to reserve time'
                : 'Click "Start Instance" to begin'
              : 'Use "Schedule Session" to book time with shared licenses',
          inline: false,
        },
      ]);

    // Send admin key privately via DM
    const adminKeyEmbed = new EmbedBuilder()
      .setColor("#ff9900")
      .setTitle("🔑 Admin Key")
      .setDescription("Your administrator password for Foundry VTT")
      .addFields([
        {
          name: "Key",
          value: `\`${result.adminKey}\``,
          inline: false,
        },
        {
          name: "Note",
          value: "Keep this private. Use when logging in as admin.",
          inline: false,
        },
      ]);

    // Create different action rows based on license type
    const actionRow = new ActionRowBuilder();

    if (licenseType === "byol") {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_start_${userId}`)
          .setLabel("Start Instance")
          .setStyle(ButtonStyle.Success)
          .setEmoji("🚀"),
        new ButtonBuilder()
          .setCustomId(`foundry_schedule_${userId}`)
          .setLabel("Schedule Session")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📅"),
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_adminkey_${userId}`)
          .setLabel("Get Admin Key")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔑")
      );
    } else {
      // Pooled license users can only schedule sessions
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_schedule_${userId}`)
          .setLabel("Schedule Session")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📅"),
        new ButtonBuilder()
          .setCustomId(`foundry_sessions_${userId}`)
          .setLabel("My Sessions")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("📋"),
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_adminkey_${userId}`)
          .setLabel("Get Admin Key")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔑")
      );
    }

    // Add destroy button to a second row
    const destroyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_${userId}`)
        .setLabel("Destroy")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀")
    );

    // Add optional Ko-fi support button
    const kofiRow = createKofiSupportButton(userId);
    const components = [actionRow, destroyRow];
    if (kofiRow) components.push(kofiRow);

    await user.send({
      embeds: [successEmbed, adminKeyEmbed],
      components: components,
    });
    await channel.send({
      content: `<@${userId}> Instance ready.`,
      embeds: [successEmbed],
      components: components,
    });

    // Update the ephemeral response with success message
    await interaction.editReply({
      content: `✅ **Instance created**\n\nChannel: ${channel}\nAdmin key sent to DMs`,
    });
  } catch (error) {
    console.error("Registration error:", error);

    await interaction.editReply({
      content: `❌ **Failed to create instance**\n\n**Error:** ${error.message}\n\nPlease try again or contact an admin if the problem persists.`,
    });
  }
}

async function handleScheduleModal(interaction) {
  const userId = interaction.customId.split("_")[3];

  // Verify this is the correct user
  if (userId !== interaction.user.id) {
    return await interaction.reply({
      content: "❌ You can only schedule sessions for your own instance.",
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const title =
      interaction.fields.getTextInputValue("session_title") || "Gaming Session";
    const startTimeStr = interaction.fields.getTextInputValue("start_time");
    const timezoneStr = interaction.fields.getTextInputValue("timezone");
    const durationStr = interaction.fields.getTextInputValue("duration");

    // Parse start time (YYYY-MM-DD HH:MM format)
    const startTimeMatch = startTimeStr.match(
      /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/
    );
    if (!startTimeMatch) {
      throw new Error(
        "Invalid start time format. Use YYYY-MM-DD HH:MM (e.g., '2024-01-15 19:00')"
      );
    }

    const [, year, month, day, hour, minute] = startTimeMatch;

    // Parse timezone and convert local time to UTC
    let startTime;
    try {
      let timezone = timezoneStr.trim();

      // Convert common timezone abbreviations to UTC offsets
      const timezoneMap = {
        EST: -5,
        EDT: -4, // Eastern
        CST: -6,
        CDT: -5, // Central
        MST: -7,
        MDT: -6, // Mountain
        PST: -8,
        PDT: -7, // Pacific
        GMT: 0,
        UTC: 0, // UTC
        BST: 1, // British Summer
        CET: 1,
        CEST: 2, // Central European
      };

      let offsetHours = 0;

      // Check if it's a known abbreviation
      if (timezoneMap.hasOwnProperty(timezone.toUpperCase())) {
        offsetHours = timezoneMap[timezone.toUpperCase()];
      }
      // Handle UTC offset format (UTC-5, UTC+2, GMT-5, etc.)
      else {
        const offsetMatch = timezone.match(/(UTC|GMT)([+-]\d{1,2})/i);
        if (offsetMatch) {
          offsetHours = parseInt(offsetMatch[2]);
        }
        // Handle just offset format (-5, +2, etc.)
        else {
          const simpleOffsetMatch = timezone.match(/^([+-]\d{1,2})$/);
          if (simpleOffsetMatch) {
            offsetHours = parseInt(simpleOffsetMatch[1]);
          }
          // Try IANA timezone names
          else {
            try {
              // Create a reference date to get the timezone offset
              const testDate = new Date();
              const utcTime =
                testDate.getTime() + testDate.getTimezoneOffset() * 60000;
              const targetTime = new Date(utcTime + 0); // Start with UTC

              // Use Intl.DateTimeFormat to get the offset for the target timezone
              const targetFormatter = new Intl.DateTimeFormat("en", {
                timeZone: timezone,
                timeZoneName: "longOffset",
              });

              const targetParts = targetFormatter.formatToParts(testDate);
              const offsetPart = targetParts.find(
                (part) => part.type === "timeZoneName"
              );

              if (offsetPart && offsetPart.value.includes("GMT")) {
                const gmtMatch = offsetPart.value.match(
                  /GMT([+-]\d{1,2}):?(\d{2})?/
                );
                if (gmtMatch) {
                  offsetHours = parseInt(gmtMatch[1]);
                  const offsetMinutes = parseInt(gmtMatch[2] || "0");
                  offsetHours +=
                    (offsetHours >= 0 ? offsetMinutes : -offsetMinutes) / 60;
                } else {
                  throw new Error(
                    `Could not parse timezone offset from ${offsetPart.value}`
                  );
                }
              } else {
                throw new Error(
                  `Could not determine offset for timezone ${timezone}`
                );
              }
            } catch (tzError) {
              throw new Error(
                `Invalid timezone "${timezone}". Use "EST", "UTC-5", or "America/New_York" format`
              );
            }
          }
        }
      }

      // Create the local time as entered by user
      const localTime = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute)
      );

      // Convert to UTC by subtracting the timezone offset
      startTime = new Date(localTime.getTime() - offsetHours * 60 * 60 * 1000);
    } catch (error) {
      throw new Error(`Timezone error: ${error.message}`);
    }

    if (startTime <= new Date()) {
      throw new Error("Start time must be in the future");
    }

    // Parse duration
    const duration = parseFloat(durationStr);
    if (isNaN(duration) || duration <= 0 || duration > 24) {
      throw new Error("Duration must be a number between 0 and 24 hours");
    }

    const endTime = new Date(startTime.getTime() + duration * 60 * 60 * 1000);

    // Get user's instance to determine license type
    const statusResult = await invokeLambda({
      action: "status",
      userId: userId,
    });

    // Determine license type carefully - don't assume BYOL for missing data
    let licenseType = statusResult.licenseType;
    let preferredLicenseId;

    if (!licenseType) {
      // Handle missing license type - check other indicators
      if (
        statusResult.licenseOwnerId &&
        statusResult.licenseOwnerId !== `byol-${userId}`
      ) {
        // Has a license owner that's not themselves = pooled instance
        licenseType = "pooled";
        preferredLicenseId = undefined; // Let system auto-assign
      } else {
        // Default to BYOL for missing data
        licenseType = "byol";
        preferredLicenseId = `byol-${userId}`;
      }
    } else if (licenseType === "byol") {
      preferredLicenseId = `byol-${userId}`;
    } else {
      // pooled or other
      preferredLicenseId = undefined;
    }

    // Schedule the session
    const result = await invokeLambda({
      action: "schedule-session",
      userId: userId,
      startTime: Math.floor(startTime.getTime() / 1000),
      endTime: Math.floor(endTime.getTime() / 1000),
      licenseType: licenseType,
      sessionTitle: title,
      sessionDescription: `Scheduled from ${timezoneStr} timezone`,
      preferredLicenseId: preferredLicenseId,
    });

    if (result.success) {
      // Calculate what the user entered in their local time for confirmation
      const userLocalStart = `${year}-${month.padStart(2, "0")}-${day.padStart(
        2,
        "0"
      )} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;

      const embed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("✅ Session Scheduled Successfully")
        .setDescription(
          `Your gaming session has been scheduled!\n\n🕐 **Your Input:** ${userLocalStart} (${timezoneStr})\n⏰ **System Time:** <t:${Math.floor(
            startTime.getTime() / 1000
          )}:F>`
        )
        .addFields([
          { name: "Title", value: title, inline: true },
          { name: "Duration", value: `${duration} hours`, inline: true },
          {
            name: "License Type",
            value:
              licenseType === "byol" ? "🔑 Your License" : "🌐 Pooled License",
            inline: true,
          },
          {
            name: "📅 Session Times",
            value: `**Starts:** <t:${Math.floor(
              startTime.getTime() / 1000
            )}:F>\n**Ends:** <t:${Math.floor(endTime.getTime() / 1000)}:F>`,
            inline: false,
          },
          {
            name: "Session ID",
            value: `\`${result.sessionId}\``,
            inline: true,
          },
        ])
        .setTimestamp();

      // Description is included in sessionDescription parameter already

      if (result.conflictsResolved && result.conflictsResolved.length > 0) {
        embed.addFields([
          {
            name: "⚠️ Conflicts Resolved",
            value: `Shutdown ${result.conflictsResolved.length} running instance(s) to reserve your license.`,
            inline: false,
          },
        ]);
      }

      await interaction.editReply({ embeds: [embed] });
    } else {
      throw new Error(result.message || "Failed to schedule session");
    }
  } catch (error) {
    console.error("Schedule modal error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Failed to Schedule Session")
      .setDescription(`Error: ${error.message}`)
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleStartButton(interaction, userId) {
  const result = await invokeLambda({
    action: "start",
    userId: userId,
  });

  const embed = new EmbedBuilder()
    .setColor("#ffff00")
    .setTitle("🚀 Starting Instance")
    .setDescription("Starting up, takes 2-3 minutes.")
    .addFields([
      { name: "Status", value: "🟡 Starting", inline: true },
      { name: "Estimated Time", value: "2-3 minutes", inline: true },
      {
        name: "Your URL",
        value: result.url || "Will be available shortly",
        inline: false,
      },
    ])
    .setTimestamp();

  // Get or create user command channel (don't send duplicate to interaction reply)
  let channelId = client.userChannels.get(userId);
  let channel;

  if (!channelId) {
    // First try to find existing channel
    const user = await client.users.fetch(userId);
    channel = await findExistingCommandChannel(
      interaction.guild,
      userId,
      user.username
    );

    if (!channel) {
      // No existing channel found, create new one
      channel = await createUserCommandChannel(
        interaction.guild,
        userId,
        user.username
      );
    }
    channelId = channel.id;
  } else {
    channel = client.channels.cache.get(channelId);
  }

  if (channel) {
    // Send starting message to command channel only (avoid duplication)
    await interaction.editReply({
      content: `🚀 Starting... Check ${channel}`,
    });

    try {
      await safeChannelSend(
        channel,
        { embeds: [embed] },
        // Fallback: create new channel if current one is inaccessible
        async () => {
          const user = await client.users.fetch(userId);
          return await createUserCommandChannel(
            interaction.guild,
            userId,
            user.username
          );
        }
      );

      // Start status monitoring immediately to catch when instance becomes ready
      startStatusMonitoring(userId, channelId);
    } catch (error) {
      console.error("Failed to send message to any channel:", error);
      await interaction.editReply({
        content:
          "❌ Unable to access or create your command channel. Please contact an admin.",
      });
    }
  } else {
    console.error(
      `Channel not found for user ${userId}, channelId: ${channelId}`
    );
    await interaction.editReply({
      content:
        "❌ Command channel not found. Please try creating a new instance.",
    });
  }
}

async function handleStopButton(interaction, userId) {
  // First check if this instance is running a scheduled session
  const statusResult = await invokeLambda({
    action: "status",
    userId: userId,
  });

  // If this is a scheduled session, show confirmation dialog
  if (statusResult.linkedSessionId && statusResult.status === "running") {
    // Get session details
    const sessionResult = await invokeLambda({
      action: "list-sessions",
      userId: userId,
    });

    const session = sessionResult.sessions?.find(
      (s) => s.sessionId === statusResult.linkedSessionId
    );

    if (session && session.status === "active") {
      // Show confirmation dialog for scheduled session
      const confirmEmbed = new EmbedBuilder()
        .setColor("#ff8800")
        .setTitle("⚠️ Scheduled Session Active")
        .setDescription(
          `You're trying to stop an instance that's running a **scheduled session**.`
        )
        .addFields([
          {
            name: "Session Details",
            value: [
              `**Title:** ${session.title || "Foundry VTT Session"}`,
              `**Start:** <t:${session.startTime}:F>`,
              `**End:** <t:${session.endTime}:F>`,
              `**License Type:** ${session.licenseType?.toUpperCase()}`,
            ].join("\n"),
            inline: true,
          },
          {
            name: "What happens if you stop?",
            value: [
              "• Your session will be cancelled",
              "• The license will be freed up",
              "• Other users can use the license",
              "• You'll need to schedule a new session",
            ].join("\n"),
            inline: true,
          },
        ])
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_stop_cancel_session_${userId}`)
          .setLabel("Stop & Cancel Session")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("❌"),
        new ButtonBuilder()
          .setCustomId(`foundry_stop_restart_${userId}`)
          .setLabel("Stop & Restart Instance")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_stop_cancel_${userId}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🚫")
      );

      await interaction.editReply({
        embeds: [confirmEmbed],
        components: [actionRow],
      });
      return;
    }
  }

  // Regular stop (no scheduled session or session not active)
  await performStopInstance(interaction, userId);
}

async function performStopInstance(interaction, userId) {
  stopStatusMonitoring(userId);

  const result = await invokeLambda({
    action: "stop",
    userId: userId,
  });

  const embed = new EmbedBuilder()
    .setColor("#ff8800")
    .setTitle("⏹️ Instance Stopped")
    .setDescription("Instance stopped.")
    .addFields([
      { name: "Status", value: "🔴 Stopped", inline: true },
      {
        name: "Data",
        value: "💾 Worlds saved",
        inline: true,
      },
    ])
    .setTimestamp();

  // Create user-focused control panel (top row)
  const userControlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_schedule_${userId}`)
      .setLabel("Schedule Session")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📅")
  );

  // Add license sharing management button for BYOL users
  // We need to get the current status to check license type
  try {
    const statusResult = await invokeLambda({
      action: "status",
      userId: userId,
    });

    if (statusResult.licenseType === "byol") {
      userControlRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_license_sharing_${userId}`)
          .setLabel(
            statusResult.allowLicenseSharing
              ? "Manage License Sharing"
              : "Start License Sharing"
          )
          .setStyle(
            statusResult.allowLicenseSharing
              ? ButtonStyle.Primary
              : ButtonStyle.Success
          )
          .setEmoji(statusResult.allowLicenseSharing ? "🔑" : "🤝")
      );
    }
  } catch (error) {
    console.log("Could not fetch status for license sharing button:", error);
  }

  // Create instance-focused control panel (bottom row)
  const instanceControlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_start_${userId}`)
      .setLabel("Start Instance")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🚀"),
    new ButtonBuilder()
      .setCustomId(`foundry_status_${userId}`)
      .setLabel("Check Status")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄"),
    new ButtonBuilder()
      .setCustomId(`foundry_destroy_${userId}`)
      .setLabel("Destroy")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("💀")
  );

  const components = [userControlRow, instanceControlRow];

  await interaction.editReply({ embeds: [embed], components: components });
}

async function handleStatusButton(interaction, userId) {
  const result = await invokeLambda({
    action: "status",
    userId: userId,
  });

  // Try to update existing message, or send new one if not found
  const existingMessageId = client.userStatusMessages.get(userId);
  let messageUpdated = false;

  if (existingMessageId) {
    try {
      const existingMessage = await interaction.channel.messages.fetch(
        existingMessageId
      );

      if (result.status === "running") {
        // For running instances, we need to send a new message since control panel has buttons
        await existingMessage.delete();
        await sendInstanceControlPanel(interaction.channel, userId, result);
      } else {
        // For non-running instances, we can update the existing message
        const statusEmbed = await buildStatusEmbed(result);
        await existingMessage.edit({ embeds: [statusEmbed] });
        messageUpdated = true;
      }
    } catch (error) {
      console.log(
        `Could not update existing message for ${userId}, sending new one:`,
        error.message
      );
      // Message not found or can't be edited, send new one
      if (result.status === "running") {
        await sendInstanceControlPanel(interaction.channel, userId, result);
      } else {
        await sendStatusUpdate(interaction.channel, result);
      }
    }
  } else {
    // No existing message, send new one
    if (result.status === "running") {
      await sendInstanceControlPanel(interaction.channel, userId, result);
    } else {
      await sendStatusUpdate(interaction.channel, result);
    }
  }

  await interaction.editReply({ content: "🔄 Status refreshed above." });
}

async function handleStopCancelSession(interaction, userId) {
  await interaction.deferUpdate();

  try {
    // First get the current status to find the linked session
    const statusResult = await invokeLambda({
      action: "status",
      userId: userId,
    });

    if (!statusResult.linkedSessionId) {
      throw new Error("No linked session found");
    }

    // Cancel the session first
    const cancelResult = await invokeLambda({
      action: "cancel-session",
      userId: userId,
      sessionId: statusResult.linkedSessionId,
    });

    // Then stop the instance
    const stopResult = await invokeLambda({
      action: "stop",
      userId: userId,
    });

    const embed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Session Cancelled & Instance Stopped")
      .setDescription(
        "Your scheduled session has been cancelled and the instance stopped."
      )
      .addFields([
        { name: "Session Status", value: "❌ Cancelled", inline: true },
        { name: "Instance Status", value: "🔴 Stopped", inline: true },
        { name: "License", value: "🔄 Freed up for others", inline: true },
        {
          name: "What's Next?",
          value:
            "You can schedule a new session or start your instance on-demand (BYOL only).",
          inline: false,
        },
      ])
      .setTimestamp();

    // Create action buttons based on license type
    const actionRow = new ActionRowBuilder();

    if (statusResult.licenseType === "byol") {
      // BYOL users can start on-demand or schedule
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_start_${userId}`)
          .setLabel("Start Instance")
          .setStyle(ButtonStyle.Success)
          .setEmoji("🚀"),
        new ButtonBuilder()
          .setCustomId(`foundry_schedule_${userId}`)
          .setLabel("Schedule Session")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📅")
      );
    } else {
      // Pooled users can only schedule
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_schedule_${userId}`)
          .setLabel("Schedule Session")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📅")
      );
    }

    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_status_${userId}`)
        .setLabel("Refresh Status")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_${userId}`)
        .setLabel("Destroy")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀")
    );

    await interaction.editReply({ embeds: [embed], components: [actionRow] });
  } catch (error) {
    console.error("Stop cancel session error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Error")
      .setDescription(
        `Failed to cancel session and stop instance: ${error.message}`
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleStopRestart(interaction, userId) {
  await interaction.deferUpdate();

  try {
    // First get the current status to check license type
    const statusResult = await invokeLambda({
      action: "status",
      userId: userId,
    });

    // Check if this is a pooled license (which can't restart on-demand)
    if (statusResult.licenseType === "pooled") {
      const errorEmbed = new EmbedBuilder()
        .setColor("#ff0000")
        .setTitle("❌ Cannot Restart Pooled Instance")
        .setDescription(
          "Pooled license instances cannot be restarted on-demand. You must schedule a new session."
        )
        .addFields([
          {
            name: "What you can do:",
            value:
              "• Schedule a new session\n• Wait for your current session to end\n• Contact an admin if you need immediate access",
            inline: false,
          },
        ])
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_schedule_${userId}`)
          .setLabel("Schedule New Session")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📅"),
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Refresh Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄")
      );

      await interaction.editReply({
        embeds: [errorEmbed],
        components: [actionRow],
      });
      return;
    }

    // For BYOL instances, stop and then start
    const stopResult = await invokeLambda({
      action: "stop",
      userId: userId,
    });

    // Wait a moment for the stop to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const startResult = await invokeLambda({
      action: "start",
      userId: userId,
    });

    const embed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🔄 Instance Restarted")
      .setDescription(
        "Your instance has been stopped and restarted successfully."
      )
      .addFields([
        { name: "Status", value: "🟢 Running", inline: true },
        { name: "License Type", value: "BYOL (On-Demand)", inline: true },
        { name: "Auto-Shutdown", value: "6 hours from now", inline: true },
      ])
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_stop_${userId}`)
        .setLabel("Stop Instance")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("⏹️"),
      new ButtonBuilder()
        .setCustomId(`foundry_status_${userId}`)
        .setLabel("Refresh Status")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId(`foundry_adminkey_${userId}`)
        .setLabel("Get Admin Key")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔑"),
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_${userId}`)
        .setLabel("Destroy")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀")
    );

    await interaction.editReply({ embeds: [embed], components: [actionRow] });
  } catch (error) {
    console.error("Stop restart error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Error")
      .setDescription(`Failed to restart instance: ${error.message}`)
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleStopCancel(interaction, userId) {
  await interaction.deferUpdate();

  // Just show the current status without doing anything
  const result = await invokeLambda({
    action: "status",
    userId: userId,
  });

  if (result.status === "running") {
    await sendInstanceControlPanel(interaction.channel, userId, result);
  } else {
    await sendStatusUpdate(interaction.channel, result);
  }

  await interaction.editReply({
    content: "✅ Stop cancelled. Current status shown above.",
  });
}

async function handleAdminKeyButton(interaction, userId) {
  const result = await invokeLambda({
    action: "status",
    userId: userId,
  });

  const user = await client.users.fetch(userId);

  const adminKeyEmbed = new EmbedBuilder()
    .setColor("#ff9900")
    .setTitle("🔑 Admin Key")
    .setDescription("Your administrator password")
    .addFields([
      {
        name: "Key",
        value: `\`${result.adminKey}\``,
        inline: false,
      },
      {
        name: "Usage",
        value: "Use when logging in as admin",
        inline: false,
      },
    ])
    .setTimestamp();

  await user.send({ embeds: [adminKeyEmbed] });

  await interaction.editReply({
    content: "🔑 I've sent your admin key to your DMs for security.",
  });
}

async function handleDestroyButton(interaction, userId) {
  // First check if user has an active license pool
  let hasActiveLicenseSharing = false;
  let licensePoolInfo = null;

  try {
    const adminResult = await invokeLambda({
      action: "admin-overview",
      userId: userId,
    });

    if (adminResult.licenses && adminResult.licenses.pools) {
      const userLicensePool = adminResult.licenses.pools.find(
        (pool) => pool.ownerId === userId && pool.isActive
      );

      if (userLicensePool) {
        hasActiveLicenseSharing = true;
        licensePoolInfo = userLicensePool;
      }
    }
  } catch (error) {
    console.log("Could not check license pools for destroy flow");
  }

  if (hasActiveLicenseSharing) {
    // User has active license sharing - send DM with options
    const user = await client.users.fetch(userId);

    const dmEmbed = new EmbedBuilder()
      .setColor("#ff9900")
      .setTitle("⚠️ License Sharing Active - Choose Action")
      .setDescription(
        "**Your license is currently being shared with the community!**\n\nBefore destroying your instance, please decide what to do with your shared license:"
      )
      .addFields([
        {
          name: "🤝 Your Shared License",
          value: `**${licensePoolInfo.ownerUsername}**\nMax Users: ${licensePoolInfo.maxConcurrentUsers}\nStatus: 🟢 Active`,
          inline: false,
        },
        {
          name: "⚠️ Instance Destruction Will",
          value:
            "• Delete all your worlds and game data\n• Remove your instance configuration\n• **Your choice below affects license sharing**",
          inline: false,
        },
        {
          name: "Choose License Sharing Action",
          value:
            "• **Keep Sharing**: License stays active for community use, you can re-register later\n• **Stop Sharing**: Remove license from pool, then destroy instance",
          inline: false,
        },
      ])
      .setFooter({
        text: "This message was sent privately due to license sharing settings",
      });

    const dmActionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_keep_sharing_${userId}`)
        .setLabel("Keep Sharing + Destroy Instance")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🤝"),
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_stop_sharing_${userId}`)
        .setLabel("Stop Sharing + Destroy Instance")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🛑"),
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_cancel_${userId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );

    try {
      await user.send({
        embeds: [dmEmbed],
        components: [dmActionRow],
      });

      // Update the interaction to indicate DM was sent
      await interaction.editReply({
        content:
          "📨 **License sharing options sent to your DMs**\n\nPlease check your direct messages to choose how to handle your shared license before destroying your instance.",
      });
    } catch (error) {
      // If DM fails, show options in the channel
      await interaction.editReply({
        embeds: [dmEmbed],
        components: [dmActionRow],
      });
    }
  } else {
    // Normal destruction flow for non-sharing users
    const confirmEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("⚠️ Confirm Destruction")
      .setDescription("This will delete your instance and all data.")
      .addFields([
        { name: "Warning", value: "🗑️ Cannot be undone" },
        {
          name: "Data Loss",
          value: "All worlds and assets will be deleted",
        },
      ]);

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_confirm_${userId}`)
        .setLabel("CONFIRM DESTROY")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀"),
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_cancel_${userId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );

    await interaction.editReply({
      embeds: [confirmEmbed],
      components: [confirmRow],
    });
  }
}

async function handleDestroyConfirmButton(interaction, userId) {
  const result = await invokeLambda({
    action: "destroy",
    userId: userId,
  });

  const instanceFound = result.instanceFound !== false;
  const licensePoolDeactivated = result.licensePoolDeactivated || false;

  const embed = new EmbedBuilder()
    .setColor("#ff0000")
    .setTitle(
      instanceFound
        ? "💀 Instance Destroyed"
        : licensePoolDeactivated
        ? "✅ License Pool Deactivated"
        : "ℹ️ No Instance Found"
    )
    .setDescription(
      instanceFound
        ? "Instance destroyed."
        : licensePoolDeactivated
        ? "No instance found, but your orphaned license pool has been deactivated."
        : "No instance or license pool found to destroy."
    )
    .addFields([
      {
        name: "Status",
        value: instanceFound ? "🗑️ Destroyed" : "❔ Not Found",
        inline: true,
      },
      {
        name: "Data",
        value: instanceFound ? "All data deleted" : "No data found",
        inline: true,
      },
      ...(licensePoolDeactivated && !instanceFound
        ? [
            {
              name: "License Pool",
              value: "🔴 Deactivated (was orphaned)",
              inline: true,
            },
          ]
        : []),
    ])
    .setTimestamp();

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_register_${userId}`)
      .setLabel("Create New Instance")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🆕")
  );

  await interaction.editReply({
    embeds: [embed],
    components: [actionRow],
  });

  // Clean up user channel (only if instance was actually destroyed)
  if (interaction.guild && instanceFound) {
    await deleteUserCommandChannel(interaction.guild, userId);
  }
}

async function handleDestroyCancelButton(interaction, userId) {
  const embed = new EmbedBuilder()
    .setColor("#00ff00")
    .setTitle("✅ Destruction Cancelled")
    .setDescription("Instance not destroyed.")
    .setTimestamp();

  // If this is from a DM (license sharing flow), show different message
  if (!interaction.guild) {
    await interaction.editReply({
      content:
        "✅ **Destruction cancelled**\n\nYour instance and license sharing settings remain unchanged.",
    });
    return;
  }

  // If from guild channel, show normal cancel message with buttons
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_status_${userId}`)
      .setLabel("Check Status")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄"),
    new ButtonBuilder()
      .setCustomId(`foundry_destroy_${userId}`)
      .setLabel("Destroy Instance")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("💀")
  );

  await interaction.editReply({
    embeds: [embed],
    components: [actionRow],
  });
}


// ================================================================================
// SELECT MENU HANDLERS
// ================================================================================
async function handleSelectMenuInteraction(interaction) {
  const parts = interaction.customId.split("_");

  if (parts[0] !== "foundry") return;

  let menuType, userId;

  if (parts[1] === "version") {
    // Format: foundry_version_userId
    menuType = "version";
    userId = parts[2];
  } else if (parts[1] === "license" && parts[2] === "select") {
    // Format: foundry_license_select_userId
    menuType = "license";
    userId = parts[3];
  } else if (
    parts[1] === "pooled" &&
    parts[2] === "license" &&
    parts[3] === "select"
  ) {
    // Format: foundry_pooled_license_select_userId
    menuType = "pooled_license";
    userId = parts[4];
  } else {
    return; // Unknown format
  }

  // Check if user can interact with this menu (skip admin check for DMs)
  if (
    userId !== interaction.user.id &&
    interaction.guild &&
    !hasAdminRole(interaction.member)
  ) {
    return await interaction.reply({
      content: "❌ You can only control your own instance.",
      ephemeral: true,
    });
  }

  if (menuType === "version") {
    await handleVersionSelection(interaction, userId);
  } else if (menuType === "license") {
    await handleLicenseSelection(interaction, userId);
  } else if (menuType === "pooled_license") {
    // Legacy handler - redirect to automatic pooled creation
    await interaction.reply({
      content:
        "❌ Manual license selection is no longer supported. Pooled instances now use automatic license assignment at session start.",
      ephemeral: true,
    });
  }
}

async function handleLicenseSelection(interaction, userId) {
  const selectedValue = interaction.values[0];
  const [licenseType, sharing] = selectedValue.split("_");

  if (licenseType === "pooled") {
    // For pooled licenses, create instance without pre-selecting a license
    await interaction.deferUpdate();

    try {
      // Check if any licenses are available
      const poolsResult = await invokeLambda({
        action: "admin-overview",
        userId: userId,
      });

      const availablePools = poolsResult.licenses.pools.filter(
        (pool) => pool.isActive
      );

      if (availablePools.length === 0) {
        return await interaction.editReply({
          content:
            "❌ No shared licenses are currently available. Please try again later or use your own license.",
          components: [],
        });
      }

      // Create pooled instance without specific license selection
      const user = await client.users.fetch(userId);
      const sanitizedUsername = sanitizeUsername(user.username);

      await interaction.editReply({
        content:
          "🔄 **Creating your pooled instance...**\n\nLicense will be automatically assigned when you schedule sessions. Please wait...",
        components: [],
      });

      const result = await invokeLambda({
        action: "create",
        userId: userId,
        sanitizedUsername: sanitizedUsername,
        licenseType: "pooled",
        // No selectedLicenseId - license will be assigned dynamically
      });

      // Create user command channel
      const channel = await createUserCommandChannel(
        interaction.guild,
        userId,
        user.username
      );

      const successEmbed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("✅ Pooled Instance Created")
        .setDescription(`Command channel: ${channel}`)
        .addFields([
          { name: "Status", value: "⚪ Created", inline: true },
          {
            name: "License Type",
            value: "🌐 Pooled - Uses Available Community Licenses",
            inline: true,
          },
          {
            name: "License Assignment",
            value: `Automatic (${availablePools.length} license(s) available)`,
            inline: true,
          },
          {
            name: "Your URL",
            value: result.url || "Available after session start",
            inline: false,
          },
          {
            name: "Foundry Version",
            value: `\`felddy/foundryvtt:13\` (v13 - Latest Stable)`,
            inline: true,
          },
          {
            name: "Access Rules",
            value: "⚠️ Schedule-only access - licenses assigned automatically",
            inline: true,
          },
          {
            name: "Next Step",
            value:
              'Use "Schedule Session" to book time (system will automatically assign an available license)',
            inline: false,
          },
        ]);

      // Send admin key privately via DM
      const adminKeyEmbed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle("🔑 Admin Key")
        .setDescription("Your administrator password for Foundry VTT")
        .addFields([
          {
            name: "Key",
            value: `\`${result.adminKey}\``,
            inline: false,
          },
          {
            name: "Note",
            value: "Keep this private. Use when logging in as admin.",
            inline: false,
          },
        ]);

      // Pooled license users can only schedule sessions
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_schedule_${userId}`)
          .setLabel("Schedule Session")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📅"),
        new ButtonBuilder()
          .setCustomId(`foundry_sessions_${userId}`)
          .setLabel("My Sessions")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("📋"),
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_adminkey_${userId}`)
          .setLabel("Get Admin Key")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔑")
      );

      // Add destroy button to a second row
      const destroyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_destroy_${userId}`)
          .setLabel("Destroy")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("💀")
      );

      await user.send({
        embeds: [successEmbed, adminKeyEmbed],
        components: [actionRow, destroyRow],
      });

      await channel.send({
        content: `<@${userId}> Pooled instance created with automatic license assignment.`,
        embeds: [successEmbed],
        components: [actionRow, destroyRow],
      });

      // Update the interaction with success message
      await interaction.editReply({
        content: `✅ **Pooled instance created**\n\nChannel: ${channel}\nLicense assignment: Smart (prioritizes your own)\nAdmin key sent to DMs`,
      });
    } catch (error) {
      console.error("Error creating pooled instance:", error);
      await interaction.editReply({
        content: `❌ **Failed to create pooled instance**\n\n**Error:** ${error.message}\n\nPlease try again or contact an admin if the problem persists.`,
        components: [],
      });
    }
  } else {
    // For BYOL licenses, show credential modal
    const allowLicenseSharing = sharing === "share";

    const credentialsModal = new ModalBuilder()
      .setCustomId(
        `foundry_credentials_${userId}_${licenseType}_${allowLicenseSharing}`
      )
      .setTitle("🔑 Foundry VTT Credentials");

    const usernameInput = new TextInputBuilder()
      .setCustomId("foundry_username")
      .setLabel("Foundry VTT Username")
      .setPlaceholder("Your username from foundryvtt.com")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const passwordInput = new TextInputBuilder()
      .setCustomId("foundry_password")
      .setLabel("Foundry VTT Password")
      .setPlaceholder("Your password from foundryvtt.com")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const usernameRow = new ActionRowBuilder().addComponents(usernameInput);
    const passwordRow = new ActionRowBuilder().addComponents(passwordInput);

    credentialsModal.addComponents(usernameRow, passwordRow);

    await interaction.showModal(credentialsModal);
  }
}

async function handleReregisterBYOL(interaction, userId) {
  // Prevent instance creation in DMs - must be done in server
  if (!interaction.guild) {
    return await interaction.reply({
      content: [
        "❌ **Instance creation must be done in the server**",
        "",
        "Please use the `/foundry dashboard` command in the server to register your instance.",
        "",
        "This ensures proper role verification and channel creation.",
      ].join("\n"),
      ephemeral: true,
    });
  }

  await interaction.deferUpdate();

  try {
    // Re-register using existing credentials (preserved when license sharing was kept)
    const user = await client.users.fetch(userId);
    const sanitizedUsername = sanitizeUsername(user.username);

    await interaction.editReply({
      content:
        "🔄 **Re-creating your BYOL instance...**\n\nUsing your preserved credentials. Please wait...",
      components: [],
    });

    const result = await invokeLambda({
      action: "create",
      userId: userId,
      sanitizedUsername: sanitizedUsername,
      licenseType: "byol",
      allowLicenseSharing: true, // Keep sharing since they had a license pool
      maxConcurrentUsers: 1,
      // No foundryUsername/foundryPassword - backend will reuse existing credentials
    });

    // Create user command channel
    const channel = await createUserCommandChannel(
      interaction.guild,
      userId,
      user.username
    );

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("✅ BYOL Instance Re-created")
      .setDescription(`Command channel: ${channel}`)
      .addFields([
        { name: "Status", value: "⚪ Created", inline: true },
        {
          name: "License Type",
          value: "🤝 BYOL - Sharing with Community",
          inline: true,
        },
        {
          name: "Your URL",
          value: result.url || "Available after startup",
          inline: false,
        },
        {
          name: "Foundry Version",
          value: `\`felddy/foundryvtt:13\` (v13 - Latest Stable)`,
          inline: true,
        },
        {
          name: "License Sharing",
          value: "✅ Still active in community pool",
          inline: true,
        },
        {
          name: "Next Step",
          value:
            'Click "Start Instance" for on-demand access, or "Schedule Session" to reserve time',
          inline: false,
        },
      ]);

    // Send admin key privately via DM
    const adminKeyEmbed = new EmbedBuilder()
      .setColor("#ff9900")
      .setTitle("🔑 Admin Key")
      .setDescription("Your administrator password for Foundry VTT")
      .addFields([
        {
          name: "Key",
          value: `\`${result.adminKey}\``,
          inline: false,
        },
        {
          name: "Note",
          value: "Keep this private. Use when logging in as admin.",
          inline: false,
        },
      ]);

    // BYOL users get full controls
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_start_${userId}`)
        .setLabel("Start Instance")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🚀"),
      new ButtonBuilder()
        .setCustomId(`foundry_schedule_${userId}`)
        .setLabel("Schedule Session")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📅"),
      new ButtonBuilder()
        .setCustomId(`foundry_status_${userId}`)
        .setLabel("Check Status")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId(`foundry_adminkey_${userId}`)
        .setLabel("Get Admin Key")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔑")
    );

    // Add destroy button to a second row
    const destroyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_${userId}`)
        .setLabel("Destroy")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀")
    );

    await user.send({
      embeds: [successEmbed, adminKeyEmbed],
      components: [actionRow, destroyRow],
    });

    await channel.send({
      content: `<@${userId}> BYOL instance re-created and ready.`,
      embeds: [successEmbed],
      components: [actionRow, destroyRow],
    });

    // Update the interaction with success message
    await interaction.editReply({
      content: `✅ **BYOL instance re-created**\n\nChannel: ${channel}\nLicense sharing: Still active\nAdmin key sent to DMs`,
    });
  } catch (error) {
    console.error("Re-register BYOL error:", error);
    await interaction.editReply({
      content: `❌ **Failed to re-create BYOL instance**\n\n**Error:** ${error.message}\n\nPlease try again or contact an admin if the problem persists.`,
    });
  }
}

async function handleStopSharing(interaction, userId) {
  await interaction.deferUpdate();

  try {
    // Stop license sharing by removing from pool
    await invokeLambda({
      action: "set-license-sharing",
      userId: userId,
      licenseType: "byol",
      allowLicenseSharing: false,
    });

    const embed = new EmbedBuilder()
      .setColor("#ff9900")
      .setTitle("🛑 License Sharing Stopped")
      .setDescription(
        "Your license has been removed from the shared pool. You can now register a new instance."
      )
      .addFields([
        {
          name: "Next Step",
          value:
            "Click the button below to register a new BYOL instance with your license.",
          inline: false,
        },
      ]);

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_register`)
        .setLabel("🎮 Register New Instance")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📝")
    );

    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });
  } catch (error) {
    console.error("Error stopping license sharing:", error);
    await interaction.editReply({
      content: `❌ Failed to stop license sharing: ${error.message}`,
      components: [],
    });
  }
}

async function handleCreatePooledAutomatic(interaction, userId) {
  // Prevent instance creation in DMs - must be done in server
  if (!interaction.guild) {
    return await interaction.reply({
      content: [
        "❌ **Instance creation must be done in the server**",
        "",
        "Please use the `/foundry dashboard` command in the server to register your instance.",
        "",
        "This ensures proper role verification and channel creation.",
      ].join("\n"),
      ephemeral: true,
    });
  }

  await interaction.deferUpdate();

  try {
    // Check if any licenses are available
    const poolsResult = await invokeLambda({
      action: "admin-overview",
      userId: userId,
    });

    const availablePools = poolsResult.licenses.pools.filter(
      (pool) => pool.isActive
    );

    if (availablePools.length === 0) {
      return await interaction.editReply({
        content: [
          "❌ **No shared licenses available**",
          "",
          "There are currently no active shared licenses in the community pool.",
          "",
          "**Options:**",
          "• Use 'Re-register My Instance' to create a BYOL instance with full control",
          "• Wait for others to share their licenses",
          "• Use 'Stop License Sharing' to remove your license from the pool and register normally",
        ].join("\n"),
        components: [],
      });
    }

    // Create pooled instance with automatic license assignment
    const user = await client.users.fetch(userId);
    const sanitizedUsername = sanitizeUsername(user.username);

    await interaction.editReply({
      content:
        "🔄 **Creating your pooled instance...**\n\nLicense will be automatically assigned when you schedule sessions. Please wait...",
      components: [],
    });

    const result = await invokeLambda({
      action: "create",
      userId: userId,
      sanitizedUsername: sanitizedUsername,
      licenseType: "pooled",
      // No selectedLicenseId - license will be assigned dynamically at session start
    });

    // Create user command channel
    const channel = await createUserCommandChannel(
      interaction.guild,
      userId,
      user.username
    );

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("✅ Pooled Instance Created")
      .setDescription(`Command channel: ${channel}`)
      .addFields([
        { name: "Status", value: "⚪ Created", inline: true },
        {
          name: "License Type",
          value: "🌐 Pooled - Smart License Assignment",
          inline: true,
        },
        {
          name: "License Assignment",
          value: `Automatic - prioritizes your own license (${availablePools.length} license(s) available)`,
          inline: true,
        },
        {
          name: "Your URL",
          value: result.url || "Available after session start",
          inline: false,
        },
        {
          name: "Foundry Version",
          value: `\`felddy/foundryvtt:13\` (v13 - Latest Stable)`,
          inline: true,
        },
        {
          name: "Access Rules",
          value:
            "⚠️ Schedule-only access - optimal license assigned automatically",
          inline: true,
        },
        {
          name: "Next Step",
          value:
            'Use "Schedule Session" to book time (system will automatically assign the best available license, starting with your own if shared)',
          inline: false,
        },
      ]);

    // Send admin key privately via DM
    const adminKeyEmbed = new EmbedBuilder()
      .setColor("#ff9900")
      .setTitle("🔑 Admin Key")
      .setDescription("Your administrator password for Foundry VTT")
      .addFields([
        {
          name: "Key",
          value: `\`${result.adminKey}\``,
          inline: false,
        },
        {
          name: "Note",
          value: "Keep this private. Use when logging in as admin.",
          inline: false,
        },
      ]);

    // Pooled license users can only schedule sessions
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_schedule_${userId}`)
        .setLabel("Schedule Session")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📅"),
      new ButtonBuilder()
        .setCustomId(`foundry_sessions_${userId}`)
        .setLabel("My Sessions")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📋"),
      new ButtonBuilder()
        .setCustomId(`foundry_status_${userId}`)
        .setLabel("Check Status")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId(`foundry_adminkey_${userId}`)
        .setLabel("Get Admin Key")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔑")
    );

    // Add destroy button to a second row
    const destroyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_${userId}`)
        .setLabel("Destroy")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀")
    );

    await user.send({
      embeds: [successEmbed, adminKeyEmbed],
      components: [actionRow, destroyRow],
    });

    await channel.send({
      content: `<@${userId}> Pooled instance created with automatic license assignment.`,
      embeds: [successEmbed],
      components: [actionRow, destroyRow],
    });

    // Update the interaction with success message
    await interaction.editReply({
      content: `✅ **Pooled instance created**\n\nChannel: ${channel}\nLicense assignment: Smart (prioritizes your own)\nAdmin key sent to DMs`,
    });
  } catch (error) {
    console.error("Error creating automatic pooled instance:", error);
    await interaction.editReply({
      content: `❌ **Failed to create pooled instance**\n\n**Error:** ${error.message}\n\nPlease try again or contact an admin if the problem persists.`,
      components: [],
    });
  }
}

async function handleDestroyKeepSharing(interaction, userId) {
  await interaction.deferReply({ ephemeral: true });

  try {
    console.log(
      `Destroying instance for user ${userId} while keeping license sharing active`
    );

    // Destroy instance but keep license sharing active
    const result = await invokeLambda({
      action: "destroy",
      userId: userId,
      keepLicenseSharing: true, // Special flag to preserve license pool
    });

    console.log(`Destroy with keep sharing result:`, result);

    const instanceFound = result.instanceFound !== false;

    const embed = new EmbedBuilder()
      .setColor("#ff9900")
      .setTitle(
        instanceFound
          ? "✅ Instance Destroyed - License Sharing Kept Active"
          : "✅ License Sharing Kept Active"
      )
      .setDescription(
        instanceFound
          ? "Your instance has been destroyed but your license remains shared with the community."
          : "No instance was found to destroy, but your license remains shared with the community."
      )
      .addFields([
        {
          name: "Instance Status",
          value: instanceFound ? "🗑️ Destroyed" : "❔ Already Gone",
          inline: true,
        },
        { name: "License Sharing", value: "🟢 Still Active", inline: true },
        {
          name: "Data",
          value: instanceFound
            ? "All instance data deleted"
            : "No instance data found",
          inline: true,
        },
        {
          name: "What's Next?",
          value:
            "• Your license is still available for others to use\n• You can re-register anytime with 'BYOL + Share' or 'Pooled' options\n• Others can continue using your shared license",
          inline: false,
        },
      ])
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_register`)
        .setLabel("🎮 Register New Instance")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📝")
    );

    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });

    // Keep the command channel since license sharing is still active
    // Users need this channel to manage their license sharing or create new instances
    console.log(
      "Keeping command channel active - license sharing is still active"
    );

    // Send a follow-up message to the channel explaining the situation
    try {
      const guild = interaction.guild || client.guilds.cache.first();
      if (guild) {
        const channel = await findExistingCommandChannel(guild, userId);
        if (channel) {
          const channelEmbed = new EmbedBuilder()
            .setColor("#ffaa00")
            .setTitle("🔄 Instance Destroyed - Channel Kept Active")
            .setDescription(
              "Your instance has been destroyed, but this channel remains active because your license is still shared with the community."
            )
            .addFields([
              {
                name: "📋 What You Can Do",
                value:
                  "• **Create New Instance** - Register a new instance using your shared license\n" +
                  "• **Stop License Sharing** - Use `/foundry user license-sharing` to make your license private\n" +
                  "• **Manage Sharing** - Control when and how your license is shared",
                inline: false,
              },
              {
                name: "🤝 Community Impact",
                value:
                  "Your license is still helping others who don't have their own license",
                inline: true,
              },
              {
                name: "🔄 Next Steps",
                value:
                  "Use the buttons below or `/foundry user` commands to manage your setup",
                inline: true,
              },
            ])
            .setFooter({
              text: "Channel will be removed when you stop license sharing",
            })
            .setTimestamp();

          const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`foundry_register_${userId}`)
              .setLabel("Create New Instance")
              .setStyle(ButtonStyle.Success)
              .setEmoji("🆕"),
            new ButtonBuilder()
              .setCustomId(`foundry_license_sharing_${userId}`)
              .setLabel("Manage License Sharing")
              .setStyle(ButtonStyle.Primary)
              .setEmoji("🔑")
          );

          await channel.send({
            embeds: [channelEmbed],
            components: [actionRow],
          });
        }
      }
    } catch (channelError) {
      console.log("Channel follow-up failed (non-critical):", channelError);
    }
  } catch (error) {
    console.error("Error destroying instance while keeping sharing:", error);
    await interaction.editReply({
      content: `❌ **Failed to destroy instance**\n\n**Error:** ${error.message}\n\nPlease try again or contact an admin.`,
      components: [],
    });
  }
}

async function handleDestroyStopSharing(interaction, userId) {
  await interaction.deferReply({ ephemeral: true });

  try {
    console.log(
      `Stopping license sharing and destroying instance for user ${userId}`
    );

    // First stop license sharing
    const sharingResult = await invokeLambda({
      action: "set-license-sharing",
      userId: userId,
      licenseType: "byol",
      allowLicenseSharing: false,
    });

    console.log(`License sharing result:`, sharingResult);

    // Then destroy the instance if it exists
    let destroyResult = null;
    if (sharingResult.instanceFound) {
      destroyResult = await invokeLambda({
        action: "destroy",
        userId: userId,
      });
      console.log(`Destroy result:`, destroyResult);
    } else {
      console.log(
        `No instance to destroy for user ${userId}, only stopped license sharing`
      );
    }

    const embed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle(
        sharingResult.instanceFound
          ? "✅ License Sharing Stopped & Instance Destroyed"
          : "✅ License Sharing Stopped"
      )
      .setDescription(
        sharingResult.instanceFound
          ? "Your license has been removed from the community pool and your instance has been destroyed."
          : "Your license has been removed from the community pool. No instance was found to destroy."
      )
      .addFields([
        {
          name: "Instance Status",
          value: sharingResult.instanceFound
            ? "🗑️ Destroyed"
            : "❔ Already Gone",
          inline: true,
        },
        { name: "License Sharing", value: "🔴 Stopped", inline: true },
        {
          name: "Data",
          value: sharingResult.instanceFound
            ? "All instance data deleted"
            : "No instance data found",
          inline: true,
        },
        {
          name: "What's Next?",
          value:
            "• Your license is no longer shared\n• You can register a new instance normally\n• Others can no longer use your license",
          inline: false,
        },
      ])
      .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_register`)
        .setLabel("🎮 Register New Instance")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📝")
    );

    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });

    // Clean up user channel since license sharing was stopped
    // Users no longer need the channel for license management
    try {
      const guild = interaction.guild || client.guilds.cache.first();
      if (guild) {
        await deleteUserCommandChannel(guild, userId);
      }
    } catch (channelError) {
      console.log("Channel cleanup failed (non-critical):", channelError);
    }
  } catch (error) {
    console.error("Error stopping sharing and destroying instance:", error);
    await interaction.editReply({
      content: `❌ **Failed to stop sharing and destroy instance**\n\n**Error:** ${error.message}\n\nPlease try again or contact an admin.`,
      components: [],
    });
  }
}

// DEPRECATED: Manual license selection removed - pooled instances now use automatic assignment
async function handleUsePooledFromExisting(interaction, userId) {
  // Show available pooled licenses (excluding user's own if they have one)
  await interaction.deferUpdate();

  try {
    const poolsResult = await invokeLambda({
      action: "admin-overview",
      userId: userId,
    });

    // Include all active license pools (including user's own)
    const availablePools = poolsResult.licenses.pools.filter(
      (pool) => pool.isActive
    );

    if (availablePools.length === 0) {
      return await interaction.editReply({
        content: [
          "❌ **No shared licenses available**",
          "",
          "There are currently no active shared licenses in the community pool.",
          "",
          "**Options:**",
          "• Use 'Re-register My Instance' to create a BYOL instance with full control",
          "• Wait for others to share their licenses",
          "• Use 'Stop License Sharing' to remove your license from the pool and register normally",
        ].join("\n"),
        components: [],
      });
    }

    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("🌐 Choose a Shared License")
      .setDescription(
        "Select which shared license you'd like to use for your new instance:"
      )
      .addFields(
        availablePools.map((pool) => ({
          name:
            pool.ownerId === userId
              ? "🔗 Your Own License (Pooled Mode)"
              : `📋 ${pool.ownerUsername}'s License`,
          value:
            pool.ownerId === userId
              ? `Your license in pooled mode\nMax Concurrent Users: ${pool.maxConcurrentUsers}\n⚠️ Schedule-only access (same rules as other pooled users)`
              : `Max Concurrent Users: ${pool.maxConcurrentUsers}\nLicense ID: \`${pool.licenseId}\``,
          inline: true,
        }))
      );

    const selectOptions = availablePools.map((pool) => ({
      label:
        pool.ownerId === userId
          ? "Your Own License (Pooled Mode)"
          : `${pool.ownerUsername}'s License`,
      description:
        pool.ownerId === userId
          ? `Your license in pooled mode - Max ${pool.maxConcurrentUsers} users, schedule-only access`
          : `Max ${pool.maxConcurrentUsers} users - ${pool.licenseId}`,
      value: pool.licenseId,
      emoji: pool.ownerId === userId ? "🔗" : "🤝",
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`foundry_pooled_license_select_${userId}`)
      .setPlaceholder("Choose a shared license...")
      .addOptions(selectOptions);

    const actionRow = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });
  } catch (error) {
    console.error("Error fetching license pools:", error);
    await interaction.editReply({
      content: "❌ Error fetching available licenses. Please try again.",
      components: [],
    });
  }
}

// DEPRECATED: Manual license selection removed - pooled instances now use automatic assignment
async function handlePooledLicenseSelection(interaction, userId) {
  const selectedLicenseId = interaction.values[0];

  await interaction.deferUpdate();

  try {
    // Get the license pool details to get the owner's credentials
    const poolsResult = await invokeLambda({
      action: "admin-overview",
      userId: userId,
    });

    const selectedPool = poolsResult.licenses.pools.find(
      (pool) => pool.licenseId === selectedLicenseId
    );

    if (!selectedPool) {
      return await interaction.editReply({
        content: "❌ Selected license is no longer available.",
        components: [],
      });
    }

    // Create instance using the license owner's credentials (backend will handle this)
    const user = await client.users.fetch(userId);
    const sanitizedUsername = sanitizeUsername(user.username);

    await interaction.editReply({
      content:
        "🔄 **Creating your pooled instance...**\n\nThis takes a few moments. Please wait...",
      components: [],
    });

    const result = await invokeLambda({
      action: "create",
      userId: userId,
      sanitizedUsername: sanitizedUsername,
      licenseType: "pooled",
      selectedLicenseId: selectedLicenseId,
      // No foundryUsername/foundryPassword - backend will use license owner's credentials
    });

    // Create user command channel
    const channel = await createUserCommandChannel(
      interaction.guild,
      userId,
      user.username
    );

    const isOwnLicense = selectedPool.ownerId === userId;

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("✅ Pooled Instance Created")
      .setDescription(`Command channel: ${channel}`)
      .addFields([
        { name: "Status", value: "⚪ Created", inline: true },
        {
          name: "License Type",
          value: isOwnLicense
            ? "🔗 Pooled - Using Your Own License"
            : "🌐 Pooled - Using Shared License",
          inline: true,
        },
        {
          name: "License Owner",
          value: isOwnLicense
            ? "You (in pooled mode)"
            : selectedPool.ownerUsername,
          inline: true,
        },
        {
          name: "Your URL",
          value: result.url || "Available after startup",
          inline: false,
        },
        {
          name: "Foundry Version",
          value: `\`felddy/foundryvtt:13\` (v13 - Latest Stable)`,
          inline: true,
        },
        {
          name: "Next Step",
          value: isOwnLicense
            ? 'Use "Schedule Session" to book time (pooled mode = schedule-only access, same rules as other users of your license)'
            : 'Use "Schedule Session" to book time with this shared license',
          inline: false,
        },
      ]);

    // Send admin key privately via DM
    const adminKeyEmbed = new EmbedBuilder()
      .setColor("#ff9900")
      .setTitle("🔑 Admin Key")
      .setDescription("Your administrator password for Foundry VTT")
      .addFields([
        {
          name: "Key",
          value: `\`${result.adminKey}\``,
          inline: false,
        },
        {
          name: "Note",
          value: "Keep this private. Use when logging in as admin.",
          inline: false,
        },
      ]);

    // Pooled license users can only schedule sessions
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_schedule_${userId}`)
        .setLabel("Schedule Session")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("📅"),
      new ButtonBuilder()
        .setCustomId(`foundry_sessions_${userId}`)
        .setLabel("My Sessions")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("📋"),
      new ButtonBuilder()
        .setCustomId(`foundry_status_${userId}`)
        .setLabel("Check Status")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔄"),
      new ButtonBuilder()
        .setCustomId(`foundry_adminkey_${userId}`)
        .setLabel("Get Admin Key")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔑")
    );

    // Add destroy button to a second row
    const destroyRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_destroy_${userId}`)
        .setLabel("Destroy")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("💀")
    );

    await user.send({
      embeds: [successEmbed, adminKeyEmbed],
      components: [actionRow, destroyRow],
    });

    await channel.send({
      content: `<@${userId}> Pooled instance ready.`,
      embeds: [successEmbed],
      components: [actionRow, destroyRow],
    });

    // Update the interaction with success message
    await interaction.editReply({
      content: `✅ **Pooled instance created**\n\nChannel: ${channel}\nUsing: ${
        isOwnLicense
          ? "Your own license (pooled mode)"
          : `${selectedPool.ownerUsername}'s license`
      }\nAdmin key sent to DMs`,
    });
  } catch (error) {
    console.error("Pooled registration error:", error);
    await interaction.editReply({
      content: `❌ **Failed to create pooled instance**\n\n**Error:** ${error.message}\n\nPlease try again or contact an admin if the problem persists.`,
    });
  }
}

async function handleVersionSelection(interaction, userId) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const selectedVersion = interaction.values[0];

    // Check current version first
    const currentStatus = await invokeLambda({
      action: "status",
      userId: userId,
    });

    // If user selected the same version they already have, show friendly message
    if (currentStatus.foundryVersion === selectedVersion) {
      const versionLabels = {
        13: "v13 - Latest Stable",
        release: "Release - Current Stable",
        12: "v12 - Previous Major",
        11: "v11 - Legacy Major",
        "13.346.0": "v13.346.0 - Specific Build",
        latest: "Latest - Bleeding Edge",
      };

      const embed = new EmbedBuilder()
        .setColor("#ffaa00")
        .setTitle("ℹ️ Version Already Selected")
        .setDescription(
          `Your instance is already using **${versionLabels[selectedVersion]}**`
        )
        .addFields([
          {
            name: "Current Version",
            value: `\`felddy/foundryvtt:${selectedVersion}\``,
            inline: true,
          },
          {
            name: "Status",
            value: "✅ No changes needed",
            inline: true,
          },
        ])
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // Update the user's instance to use the new version
    const result = await invokeLambda({
      action: "update-version",
      userId: userId,
      foundryVersion: selectedVersion,
    });

    const versionLabels = {
      13: "v13 - Latest Stable",
      release: "Release - Current Stable",
      12: "v12 - Previous Major",
      11: "v11 - Legacy Major",
      "13.346.0": "v13.346.0 - Specific Build",
      latest: "Latest - Bleeding Edge",
    };

    const embed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🔧 Version Updated")
      .setDescription(
        `Successfully updated your instance to use **${versionLabels[selectedVersion]}**`
      )
      .addFields([
        {
          name: "New Version",
          value: `\`felddy/foundryvtt:${selectedVersion}\``,
          inline: true,
        },
        { name: "Status", value: "✅ Version preference saved", inline: true },
        {
          name: "Next Steps",
          value: "Start/restart your instance to use the new version",
          inline: false,
        },
      ])
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Refresh the dashboard to show the new version
    const dashboardChannel = interaction.channel;
    if (dashboardChannel) {
      setTimeout(async () => {
        try {
          const statusResult = await invokeLambda({
            action: "status",
            userId: userId,
          });

          // Send appropriate status message based on instance state
          if (statusResult.status === "running") {
            await sendInstanceControlPanel(
              dashboardChannel,
              userId,
              statusResult
            );
          } else {
            // Send a version update notification for non-running instances
            const embed = new EmbedBuilder()
              .setColor("#00ff00")
              .setTitle("🔧 Version Updated")
              .setDescription(
                `Foundry VTT version updated to **${versionLabels[selectedVersion]}**`
              )
              .addFields([
                {
                  name: "Current Version",
                  value: `\`felddy/foundryvtt:${selectedVersion}\``,
                  inline: true,
                },
                {
                  name: "Status",
                  value: `${statusResult.status === "stopped" ? "🔴" : "⚪"} ${
                    statusResult.status
                  }`,
                  inline: true,
                },
                {
                  name: "Note",
                  value: "Version will take effect when you start the instance",
                  inline: false,
                },
              ])
              .setTimestamp();

            await dashboardChannel.send({ embeds: [embed] });
          }
        } catch (error) {
          console.error("Failed to refresh dashboard:", error);
        }
      }, 1000);
    }
  } catch (error) {
    console.error("Version selection error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Version Update Failed")
      .setDescription(`Failed to update version: ${error.message}`)
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleScheduleButton(interaction, userId) {
  // Create modal for session scheduling
  const scheduleModal = new ModalBuilder()
    .setCustomId(`foundry_schedule_modal_${userId}`)
    .setTitle("📅 Schedule Session (Use YOUR Local Time)");

  const titleInput = new TextInputBuilder()
    .setCustomId("session_title")
    .setLabel("Session Title")
    .setPlaceholder("e.g., 'D&D Campaign - Session 5'")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);

  const startTimeInput = new TextInputBuilder()
    .setCustomId("start_time")
    .setLabel("Start Time (YOUR Local Time)")
    .setPlaceholder("YYYY-MM-DD HH:MM (e.g., '2024-01-15 19:00')")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const timezoneInput = new TextInputBuilder()
    .setCustomId("timezone")
    .setLabel("Your Timezone")
    .setPlaceholder("EST, PST, UTC-5, GMT+1, America/New_York, etc.")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const durationInput = new TextInputBuilder()
    .setCustomId("duration")
    .setLabel("Duration (hours)")
    .setPlaceholder("e.g., '4' for 4 hours")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3);

  const titleRow = new ActionRowBuilder().addComponents(titleInput);
  const startRow = new ActionRowBuilder().addComponents(startTimeInput);
  const timezoneRow = new ActionRowBuilder().addComponents(timezoneInput);
  const durationRow = new ActionRowBuilder().addComponents(durationInput);

  scheduleModal.addComponents(titleRow, startRow, timezoneRow, durationRow);

  await interaction.showModal(scheduleModal);
}

async function handleSessionsButton(interaction, userId) {
  try {
    // Get user's scheduled sessions
    const result = await invokeLambda({
      action: "list-sessions",
      userId: userId,
    });

    if (result.count === 0) {
      const embed = new EmbedBuilder()
        .setColor("#888888")
        .setTitle("📋 Your Scheduled Sessions")
        .setDescription("You have no scheduled sessions.")
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // Create embed with sessions
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle(`📋 Your Scheduled Sessions (${result.count})`)
      .setTimestamp();

    const sessionsText = result.sessions
      .map((session, index) => {
        const startTime = new Date(session.startTime * 1000);
        const endTime = new Date(session.endTime * 1000);
        const status =
          {
            scheduled: "🕒 Scheduled",
            active: "🟢 Active",
            completed: "✅ Completed",
            cancelled: "❌ Cancelled",
          }[session.status] || "❔ Unknown";

        return [
          `**${index + 1}. ${session.title || "Gaming Session"}**`,
          `${status} | <t:${session.startTime}:F> - <t:${session.endTime}:t>`,
          session.description ? `*${session.description}*` : "",
          "",
        ]
          .filter((line) => line)
          .join("\n");
      })
      .join("\n");

    // Discord embed description limit is 4096 characters
    if (sessionsText.length > 4000) {
      embed.setDescription(
        sessionsText.substring(0, 3950) +
          "\n\n... (list truncated, showing latest sessions)"
      );
    } else {
      embed.setDescription(sessionsText);
    }

    // Add action buttons for session management
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_schedule_${userId}`)
        .setLabel("Schedule New")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("➕"),
      new ButtonBuilder()
        .setCustomId(`foundry_cancel_session_${userId}`)
        .setLabel("Cancel Session")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("❌")
        .setDisabled(
          result.sessions.filter((s) => s.status === "scheduled").length === 0
        )
    );

    await interaction.editReply({ embeds: [embed], components: [actionRow] });
  } catch (error) {
    console.error("Sessions list error:", error);

    const errorEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("❌ Failed to Load Sessions")
      .setDescription(`Error: ${error.message}`)
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

// Helper function to fetch system summary for stats embeds
async function fetchSystemSummary() {
  try {
    const response = await invokeLambda({
      action: "admin-overview",
      userId: "system",
    });
    return response.summary || null;
  } catch (err) {
    console.error("Failed to fetch system summary:", err.message);
    return null;
  }
}

async function buildStatsEmbed() {
  const summary = await fetchSystemSummary();
  if (!summary) {
    return new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("📊 Foundry VTT Community Statistics")
      .setDescription("Unable to retrieve statistics at this time.")
      .setTimestamp();
  }

  // Get cost data for all users
  let allCosts = null;
  try {
    const costResult = await invokeLambda({
      action: "get-all-costs",
      userId: "system",
    });
    allCosts = costResult;
  } catch (error) {
    console.log("Could not fetch cost data for stats:", error);
  }

  // Get license pool information
  let licensePools = [];
  try {
    const adminResult = await invokeLambda({
      action: "admin-overview",
      userId: "system",
    });
    if (adminResult.licenses && adminResult.licenses.pools) {
      licensePools = adminResult.licenses.pools.filter((pool) => pool.isActive);
    }
  } catch (error) {
    console.log("Could not fetch license pool data for stats:", error);
  }

  const COST_PER_HOUR = parseFloat(
    process.env.INSTANCE_COST_PER_HOUR || "0.10"
  );
  const costLine =
    summary.estimatedMonthlyCost !== undefined
      ? `$${summary.estimatedMonthlyCost.toFixed(2)}`
      : `$${(summary.runningInstances * COST_PER_HOUR * 720).toFixed(2)}`;

  // Calculate supporter credits from Discord roles
  let totalSupporterCredits = 0;
  let supporterCount = 0;

  if (client.guilds.cache.size > 0) {
    const guild = client.guilds.cache.first();
    console.log(
      `🔍 Calculating supporter credits for guild: ${guild.name} (${guild.id})`
    );

    try {
      // Use the cached members instead of fetching all at once
      const members = guild.members.cache;
      console.log(`📊 Found ${members.size} cached members in guild`);

      // If we don't have enough cached members, try to fetch more
      if (members.size < 100) {
        console.log(
          `📊 Cached members too low (${members.size}), fetching more...`
        );
        try {
          await guild.members.fetch({ limit: 1000, time: 30000 }); // 30 second timeout
          console.log(
            `📊 After fetch: ${guild.members.cache.size} members available`
          );
        } catch (fetchError) {
          console.log(
            `⚠️ Could not fetch additional members: ${fetchError.message}`
          );
        }
      }

      // Use the updated cache
      const updatedMembers = guild.members.cache;
      for (const [userId, member] of updatedMembers) {
        const supporterAmount = getUserSupporterAmount(member);
        if (supporterAmount > 0) {
          console.log(
            `🎖️ Supporter found: ${member.user.tag} (${userId}) - $${supporterAmount}`
          );
          totalSupporterCredits += supporterAmount;
          supporterCount++;
        }
      }

      console.log(
        `💰 Total supporter credits: $${totalSupporterCredits} from ${supporterCount} users`
      );
    } catch (error) {
      console.log("Could not calculate supporter credits:", error);
    }
  }

  const adjustedUncoveredCost = Math.max(
    0,
    allCosts ? allCosts.totalUncovered - totalSupporterCredits : 0
  );
  const totalCoverage = allCosts
    ? allCosts.totalDonations + totalSupporterCredits
    : 0;
  const coveragePercentage =
    allCosts && allCosts.totalCosts > 0
      ? Math.round((totalCoverage / allCosts.totalCosts) * 100)
      : 0;

  // Create the main embed
  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("📊 Foundry VTT Community Statistics")
    .setDescription("Real-time overview of our community's Foundry VTT usage")
    .setTimestamp();

  // Instance Status Row
  embed.addFields([
    {
      name: "🚀 Instance Status",
      value: [
        `**Total Instances:** ${summary.totalInstances}`,
        `**Currently Running:** ${summary.runningInstances}`,
        `**BYOL Instances:** ${summary.byolInstances}`,
        `**Shared Instances:** ${summary.pooledInstances}`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "🔗 License Pool Status",
      value: [
        `**Active License Pools:** ${licensePools.length}`,
        `**Total Shared Licenses:** ${licensePools.length}`,
        `**Available for Scheduling:** ${
          licensePools.length > 0 ? "✅ Yes" : "❌ None"
        }`,
        `**Community Members Sharing:** ${licensePools.length}`,
      ].join("\n"),
      inline: true,
    },
  ]);

  // Cost Coverage Row - Highlight the most important metric
  const coverageColor =
    coveragePercentage >= 100 ? "🟢" : coveragePercentage >= 75 ? "🟡" : "🔴";
  embed.addFields([
    {
      name: `${coverageColor} Cost Coverage (${coveragePercentage}%)`,
      value: [
        `**Monthly Cost:** ${costLine}`,
        `**Donations Received:** $${
          allCosts?.totalDonations.toFixed(2) || "0.00"
        }`,
        ...(supporterCount > 0
          ? [
              `**Supporter Credits:** $${totalSupporterCredits.toFixed(
                2
              )} (${supporterCount} users)`,
            ]
          : []),
        `**Remaining Uncovered:** $${adjustedUncoveredCost.toFixed(2)}`,
      ].join("\n"),
      inline: false,
    },
  ]);

  // License Pool Details (if any exist)
  if (licensePools.length > 0) {
    const poolDetails = licensePools
      .slice(0, 3) // Limit to first 3 to avoid embed size limits
      .map((pool) => `**${pool.ownerUsername}**`)
      .join("\n");

    const morePools =
      licensePools.length > 3
        ? `\n*+${licensePools.length - 3} more license pools...*`
        : "";

    embed.addFields([
      {
        name: "🤝 Active License Pools",
        value: poolDetails + morePools,
        inline: false,
      },
    ]);
  }

  // Footer with helpful information
  embed.setFooter({
    text: "💡 Tip: Licenses can be pooled, instances are shared. Use '/foundry dashboard' to get started!",
  });

  return embed;
}

// Periodically update all registration stats messages (every 5 minutes)
cron.schedule("*/5 * * * *", async () => {
  for (const [channelId, messageId] of client.registrationStats.entries()) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel) continue;

      const message = await channel.messages.fetch(messageId);
      if (!message) continue;

      const embed = await buildStatsEmbed();
      await message.edit({ embeds: [embed] });
    } catch (err) {
      console.error(
        `Failed to update stats message in ${channelId}:`,
        err.message
      );
    }
  }
});

// Function to refresh all stats embeds in registration channels

// ================================================================================
// REGISTRATION AND STATS
// ================================================================================
async function refreshRegistrationStats() {
  if (client.registrationStats.size === 0) return;

  console.log(
    `🔄 Refreshing registration stats for ${client.registrationStats.size} channels`
  );

  try {
    const embed = await buildStatsEmbed();
    const invalidMappings = [];

    for (const [channelId, messageId] of client.registrationStats.entries()) {
      try {
        console.log(
          `🔄 Refreshing stats in channel ${channelId}, message ${messageId}`
        );
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
          console.log(`❌ Channel ${channelId} not found, marking for cleanup`);
          invalidMappings.push(channelId);
          continue;
        }

        const message = await channel.messages.fetch(messageId);
        if (!message) {
          console.log(
            `❌ Message ${messageId} not found in channel ${channelId}, marking for cleanup`
          );
          invalidMappings.push(channelId);
          continue;
        }

        await message.edit({ embeds: [embed] });
        console.log(`✅ Successfully refreshed stats in channel ${channelId}`);
      } catch (err) {
        console.error(
          `❌ Failed to refresh stats in ${channelId}:`,
          err.message
        );

        // Check if it's a "not found" error and mark for cleanup
        if (
          err.message.includes("Unknown Message") ||
          err.message.includes("Unknown Channel")
        ) {
          console.log(`🔧 Marking invalid mapping for cleanup: ${channelId}`);
          invalidMappings.push(channelId);
        }
      }
    }

    // Clean up invalid mappings
    for (const channelId of invalidMappings) {
      console.log(
        `🧹 Cleaning up invalid registration stats mapping: ${channelId}`
      );
      client.registrationStats.delete(channelId);

      // Also remove from DynamoDB if we have access
      if (botConfigTableName) {
        try {
          await botConfigDynamo.send(
            new PutCommand({
              TableName: botConfigTableName,
              Item: {
                configKey: "registrationStats",
                channelId: null,
                messageId: null,
                updatedAt: Math.floor(Date.now() / 1000),
              },
            })
          );
          console.log(`✅ Cleared invalid mapping from DynamoDB`);
        } catch (dbErr) {
          console.error(
            `❌ Failed to clear invalid mapping from DynamoDB:`,
            dbErr.message
          );
        }
      }
    }

    console.log(
      `✅ Registration stats refresh completed. Cleaned up ${invalidMappings.length} invalid mappings.`
    );
  } catch (e) {
    console.error("❌ Failed to build stats embed:", e.message);
  }
}

async function refreshAdminStatus() {
  console.log("🔄 refreshAdminStatus called");
  console.log(`📊 Admin status mappings: ${client.adminStatusMapping.size}`);

  if (client.adminStatusMapping.size === 0) {
    console.log("⚠️ No admin status mappings, skipping refresh");
    return;
  }

  try {
    const embed = await buildAdminStatusEmbed();
    console.log("✅ Built admin status embed for refresh");

    let updatedCount = 0;
    const invalidMappings = [];

    for (const [channelId, messageId] of client.adminStatusMapping.entries()) {
      try {
        console.log(
          `🔄 Refreshing admin status in ${channelId}, message ${messageId}`
        );
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
          console.log(
            `❌ Channel ${channelId} not found during refresh, marking for cleanup`
          );
          invalidMappings.push(channelId);
          continue;
        }
        const msg = await channel.messages.fetch(messageId);
        if (!msg) {
          console.log(
            `❌ Message ${messageId} not found during refresh, marking for cleanup`
          );
          invalidMappings.push(channelId);
          continue;
        }
        await msg.edit({
          embeds: [embed],
          components: [buildAdminStatusComponents()],
        });
        updatedCount++;
        console.log(`✅ Refreshed admin status in ${channelId}`);
      } catch (err) {
        console.error(
          `❌ Failed to refresh admin status in ${channelId}:`,
          err.message
        );

        // Check if it's a "not found" error and mark for cleanup
        if (
          err.message.includes("Unknown Message") ||
          err.message.includes("Unknown Channel")
        ) {
          console.log(
            `🔧 Marking invalid admin status mapping for cleanup: ${channelId}`
          );
          invalidMappings.push(channelId);
        }
      }
    }

    // Clean up invalid mappings
    for (const channelId of invalidMappings) {
      console.log(`🧹 Cleaning up invalid admin status mapping: ${channelId}`);
      client.adminStatusMapping.delete(channelId);

      // Also remove from DynamoDB if we have access
      if (botConfigTableName) {
        try {
          await botConfigDynamo.send(
            new PutCommand({
              TableName: botConfigTableName,
              Item: {
                configKey: "adminStatus",
                channelId: null,
                messageId: null,
                updatedAt: Math.floor(Date.now() / 1000),
              },
            })
          );
          console.log(`✅ Cleared invalid admin status mapping from DynamoDB`);
        } catch (dbErr) {
          console.error(
            `❌ Failed to clear invalid admin status mapping from DynamoDB:`,
            dbErr.message
          );
        }
      }
    }

    console.log(
      `✅ refreshAdminStatus completed: ${updatedCount} channels updated, cleaned up ${invalidMappings.length} invalid mappings`
    );
  } catch (e) {
    console.error("❌ Failed to build admin status embed:", e.message);
  }
}

async function buildAdminStatusEmbed() {
  const response = await invokeLambda({
    action: "admin-overview",
    userId: "system",
  });
  const summary = response.summary;
  return new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("System Administration Dashboard")
    .setDescription(
      `Running: ${summary.runningInstances}/${summary.totalInstances} | Sessions: ${summary.activeSessions}`
    )
    .setTimestamp();
}

function buildAdminStatusComponents() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_refresh_status")
      .setLabel("🔄 Refresh")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("admin_detailed_view")
      .setLabel("📋 Detailed View")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("admin_emergency_actions")
      .setLabel("🚨 Emergency Actions")
      .setStyle(ButtonStyle.Danger)
  );
}

// Cron refresh admin status every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  console.log("🔄 Admin status cron job running...");
  console.log(`📊 Admin status mappings: ${client.adminStatusMapping.size}`);

  if (client.adminStatusMapping.size === 0) {
    console.log("⚠️ No admin status mappings found, skipping update");
    return;
  }

  try {
    const embed = await buildAdminStatusEmbed();
    console.log("✅ Built admin status embed");

    let updatedCount = 0;
    for (const [channelId, messageId] of client.adminStatusMapping.entries()) {
      try {
        console.log(
          `🔄 Updating admin status in channel ${channelId}, message ${messageId}`
        );
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
          console.log(`❌ Channel ${channelId} not found`);
          continue;
        }
        const msg = await channel.messages.fetch(messageId);
        if (!msg) {
          console.log(
            `❌ Message ${messageId} not found in channel ${channelId}`
          );
          continue;
        }
        await msg.edit({
          embeds: [embed],
          components: [buildAdminStatusComponents()],
        });
        updatedCount++;
        console.log(`✅ Updated admin status in channel ${channelId}`);
      } catch (err) {
        console.error(
          `❌ Failed to refresh admin status in ${channelId}:`,
          err.message
        );
      }
    }

    console.log(
      `✅ Admin status cron job completed: ${updatedCount} channels updated`
    );
  } catch (error) {
    console.error("❌ Admin status cron job failed:", error.message);
  }
});

// Cron job to refresh all command channels every 3 minutes
cron.schedule("*/3 * * * *", async () => {
  console.log("🔄 Auto-refreshing command channel statuses...");

  try {
    // Get all instances from Lambda (single call for efficiency)
    const result = await invokeLambda({
      action: "list-all",
      userId: "system",
    });

    let updatedCount = 0;
    let checkedCount = 0;

    for (const instance of result.instances) {
      console.log(
        `Checking instance ${instance.userId} (${instance.username}): status = ${instance.status}`
      );

      // Check all instances, not just specific statuses
      // This ensures we catch any status changes

      try {
        // Check if we have a channel mapping for this user
        const channelId = client.userChannels.get(instance.userId);
        if (!channelId) continue;

        const channel = client.channels.cache.get(channelId);
        if (!channel) continue;

        checkedCount++;

        // For instances that should be running but aren't showing as running,
        // force a status check to get the real status from ECS
        if (
          instance.taskArn &&
          instance.status !== "running" &&
          instance.status !== "stopped"
        ) {
          console.log(
            `Forcing status check for instance ${instance.userId} with taskArn ${instance.taskArn}`
          );
          try {
            const realStatus = await invokeLambda({
              action: "status",
              userId: instance.userId,
            });
            console.log(
              `Real status for ${instance.userId}: ${realStatus.status} (was ${instance.status})`
            );
            instance.status = realStatus.status;
          } catch (statusError) {
            console.log(
              `Failed to get real status for ${instance.userId}:`,
              statusError.message
            );
          }
        }

        // Check if status actually changed since last update
        const lastStatus = lastKnownStatus.get(instance.userId);
        const statusChanged =
          !lastStatus ||
          lastStatus.status !== instance.status ||
          lastStatus.updatedAt !== instance.updatedAt ||
          lastStatus.url !== instance.url;

        console.log(
          `Status check for ${instance.userId}: lastStatus = ${lastStatus?.status}, currentStatus = ${instance.status}, changed = ${statusChanged}`
        );

        if (statusChanged) {
          // Store current status
          lastKnownStatus.set(instance.userId, {
            status: instance.status,
            updatedAt: instance.updatedAt,
            url: instance.url,
          });

          // Try to update existing message, or send new one if not found
          const existingMessageId = client.userStatusMessages.get(
            instance.userId
          );
          let messageUpdated = false;

          if (existingMessageId) {
            try {
              const existingMessage = await channel.messages.fetch(
                existingMessageId
              );

              if (instance.status === "running") {
                console.log(
                  `Updating control panel for running instance ${instance.userId}`
                );
                // For running instances, we need to send a new message since control panel has buttons
                await existingMessage.delete();
                await sendInstanceControlPanel(
                  channel,
                  instance.userId,
                  instance
                );
              } else {
                console.log(
                  `Updating status message for instance ${instance.userId} with status ${instance.status}`
                );
                // For non-running instances, we can update the existing message
                const statusEmbed = await buildStatusEmbed(instance);
                await existingMessage.edit({ embeds: [statusEmbed] });
                messageUpdated = true;
              }
            } catch (error) {
              console.log(
                `Could not update existing message for ${instance.userId}, sending new one:`,
                error.message
              );
              // Message not found or can't be edited, send new one
              if (instance.status === "running") {
                await sendInstanceControlPanel(
                  channel,
                  instance.userId,
                  instance
                );
              } else {
                await sendStatusUpdate(channel, instance);
              }
            }
          } else {
            // No existing message, send new one
            if (instance.status === "running") {
              console.log(
                `Sending new control panel for running instance ${instance.userId}`
              );
              await sendInstanceControlPanel(
                channel,
                instance.userId,
                instance
              );
            } else {
              console.log(
                `Sending new status update for instance ${instance.userId} with status ${instance.status}`
              );
              await sendStatusUpdate(channel, instance);
            }
          }

          updatedCount++;
        }
      } catch (error) {
        console.log(
          `Failed to refresh status for user ${instance.userId}:`,
          error.message
        );
      }
    }

    if (checkedCount > 0) {
      console.log(
        `🔄 Checked ${checkedCount} channels, updated ${updatedCount} with changes`
      );
    }
  } catch (error) {
    console.log("⚠️ Failed to auto-refresh command channels:", error.message);
  }
});

// Clean up old status cache entries every hour to prevent memory leaks
cron.schedule("0 * * * *", async () => {
  console.log("🧹 Cleaning up old status cache entries...");

  try {
    // Get current active instances
    const result = await invokeLambda({
      action: "list-all",
      userId: "system",
    });

    const activeUserIds = new Set(result.instances.map((i) => i.userId));
    let removedCount = 0;

    // Remove cache entries for users who no longer have instances
    for (const userId of lastKnownStatus.keys()) {
      if (!activeUserIds.has(userId)) {
        lastKnownStatus.delete(userId);
        client.userStatusMessages.delete(userId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`🧹 Cleaned up ${removedCount} old status cache entries`);
    }
  } catch (error) {
    console.log("⚠️ Failed to clean up status cache:", error.message);
  }
});

// Check for scheduled session notifications every 2 minutes
cron.schedule("*/2 * * * *", async () => {
  console.log("🔔 Checking for scheduled session notifications...");

  try {
    // Get all instances to check for recently started scheduled sessions
    const result = await invokeLambda({
      action: "list-all",
      userId: "system",
    });

    const now = Math.floor(Date.now() / 1000);
    const twoMinutesAgo = now - 120; // 2 minutes ago

    for (const instance of result.instances) {
      // Check if this is a scheduled session that started recently
      if (
        instance.linkedSessionId &&
        instance.status === "running" &&
        instance.startedAt &&
        instance.startedAt >= twoMinutesAgo
      ) {
        try {
          // Get session details
          const sessionResult = await invokeLambda({
            action: "list-sessions",
            userId: instance.userId,
          });

          const session = sessionResult.sessions?.find(
            (s) => s.sessionId === instance.linkedSessionId
          );

          if (session && session.status === "active") {
            // Send notification to user
            await sendScheduledSessionNotification(
              instance.userId,
              session,
              instance
            );
          }
        } catch (error) {
          console.log(
            `Failed to send notification for user ${instance.userId}:`,
            error.message
          );
        }
      }
    }
  } catch (error) {
    console.log("⚠️ Failed to check for notifications:", error.message);
  }
});

// Function to send scheduled session notifications to users
async function sendScheduledSessionNotification(userId, session, instance) {
  try {
    // Find the user's command channel
    const channelId = client.userChannels.get(userId);
    if (!channelId) {
      console.log(`No command channel found for user ${userId}`);
      return;
    }

    const channel = client.channels.cache.get(channelId);
    if (!channel) {
      console.log(`Channel ${channelId} not found for user ${userId}`);
      return;
    }

    // Create notification embed
    const notificationEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("🎮 Scheduled Session Ready!")
      .setDescription(
        `Your scheduled session **"${
          session.title || "Foundry VTT Session"
        }"** is now ready and running!`
      )
      .addFields([
        {
          name: "Session Details",
          value: [
            `**Start Time:** <t:${session.startTime}:F>`,
            `**End Time:** <t:${session.endTime}:F>`,
            `**Duration:** ${Math.round(
              (session.endTime - session.startTime) / 60
            )} minutes`,
            `**License Type:** ${session.licenseType?.toUpperCase()}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Access Information",
          value: [
            `**URL:** ${instance.url}`,
            `**Status:** ${getStatusEmoji(instance.status)} Running`,
            `**Auto-Shutdown:** <t:${instance.autoShutdownAt}:R>`,
          ].join("\n"),
          inline: true,
        },
      ])
      .setTimestamp();

    // Send notification to the user's command channel
    await channel.send({
      content: `<@${userId}> Your scheduled session is ready! 🎉`,
      embeds: [notificationEmbed],
    });

    console.log(`✅ Sent scheduled session notification to user ${userId}`);
  } catch (error) {
    console.error(
      `Failed to send scheduled session notification to user ${userId}:`,
      error
    );
  }
}

// License sharing management functions
async function handleStartLicenseSharing(interaction, userId) {
  await interaction.deferUpdate();

  try {
    // Reactivate license sharing using the new state management system
    const result = await invokeLambda({
      action: "manage-license-state",
      userId: userId,
      licenseStateOperation: "reactivate_sharing",
    });

    if (result.success) {
      const embed = new EmbedBuilder()
        .setColor("#00ff00")
        .setTitle("✅ License Pooling Started")
        .setDescription("Your license is now pooled with the community!")
        .addFields([
          {
            name: "🤝 What happens now?",
            value:
              "• Your license is available for others to schedule sessions\n" +
              "• You maintain priority access to your own license\n" +
              "• Others can use your license when you're not using it\n" +
              "• You're helping the community!",
            inline: false,
          },
          {
            name: "🎯 Your Priority",
            value:
              "You always get priority access to your own license, even when shared",
            inline: true,
          },
          {
            name: "📊 Community Impact",
            value:
              "Your license is now helping others who don't have their own",
            inline: true,
          },
        ])
        .setFooter({ text: "Thank you for contributing to the community!" })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        components: [],
      });

      // Refresh stats to show the new license pool
      await refreshRegistrationStats();
    } else {
      throw new Error(result.error || "Failed to enable license sharing");
    }
  } catch (error) {
    console.error("Error starting license sharing:", error);
    await interaction.editReply({
      content: `❌ Failed to start license sharing: ${error.message}`,
      components: [],
    });
  }
}

async function handleStopLicenseSharing(interaction, userId) {
  await interaction.deferUpdate();

  try {
    // First, check if there are any active or scheduled sessions using this license
    const licenseId = `byol-${userId}`;
    const sessionsResult = await invokeLambda({
      action: "get-sessions-for-license",
      licenseId: licenseId,
    });

    const activeSessions =
      sessionsResult.sessions?.filter(
        (s) => s.status === "active" || s.status === "scheduled"
      ) || [];

    if (activeSessions.length > 0) {
      // There are active sessions - show warning and options
      const embed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle("⚠️ Active Sessions Using Your License")
        .setDescription(
          "There are active or scheduled sessions currently using your license. Stopping license pooling will affect these sessions."
        )
        .addFields([
          {
            name: "📋 Active Sessions",
            value:
              activeSessions.length > 0
                ? activeSessions
                    .slice(0, 3)
                    .map(
                      (session) =>
                        `**${session.title || "Session"}** - ${
                          session.username
                        }\n` + `Ends: <t:${session.endTime}:R>`
                    )
                    .join("\n\n") +
                  (activeSessions.length > 3
                    ? `\n*+${activeSessions.length - 3} more sessions...*`
                    : "")
                : "No active sessions found",
            inline: false,
          },
          {
            name: "🤔 Your Options",
            value:
              "• **Stop Pooling Now** - Sessions will be cancelled\n" +
              "• **Stop After Sessions End** - License becomes private after all sessions complete\n" +
              "• **Cancel** - Keep license pooling active",
            inline: false,
          },
        ])
        .setFooter({ text: "Choose how you want to handle existing sessions" })
        .setTimestamp();

      // Create action buttons
      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_stop_sharing_now_${userId}`)
          .setLabel("Stop Now (Cancel Sessions)")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("🚫"),
        new ButtonBuilder()
          .setCustomId(`foundry_stop_sharing_after_sessions_${userId}`)
          .setLabel("Stop After Sessions End")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("⏰"),
        new ButtonBuilder()
          .setCustomId(`foundry_stop_sharing_cancel_${userId}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("❌")
      );

      await interaction.editReply({
        embeds: [embed],
        components: [actionRow],
      });
      return;
    }

    // No active sessions - proceed with immediate stop
    await performStopLicenseSharing(interaction, userId, "immediate");
  } catch (error) {
    console.error("Error checking sessions for license sharing:", error);
    await interaction.editReply({
      content: `❌ Failed to check active sessions: ${error.message}`,
      components: [],
    });
  }
}

async function performStopLicenseSharing(
  interaction,
  userId,
  mode = "immediate"
) {
  try {
    let result;

    if (mode === "after_sessions") {
      // Schedule license sharing to stop after sessions end
      result = await invokeLambda({
        action: "manage-license-state",
        userId: userId,
        licenseStateOperation: "schedule_stop_after_sessions",
      });
    } else {
      // Immediate stop - also cancel any active sessions
      result = await invokeLambda({
        action: "manage-license-state",
        userId: userId,
        licenseStateOperation: "immediate_stop",
      });

      // Cancel active sessions if immediate mode
      if (mode === "immediate") {
        try {
          await invokeLambda({
            action: "cancel-sessions-for-license",
            licenseId: `byol-${userId}`,
          });
        } catch (cancelError) {
          console.log(
            "Warning: Could not cancel sessions:",
            cancelError.message
          );
        }
      }
    }

    if (result.success) {
      const embed = new EmbedBuilder()
        .setColor(mode === "after_sessions" ? "#ffaa00" : "#ff9900")
        .setTitle(
          mode === "after_sessions"
            ? "⏰ License Pooling Scheduled to Stop"
            : "🔒 License Pooling Stopped"
        )
        .setDescription(
          mode === "after_sessions"
            ? "Your license will become private after all current sessions end."
            : "Your license is now private and only used by your own instance."
        )
        .addFields([
          {
            name:
              mode === "after_sessions"
                ? "⏰ What happens next?"
                : "🔐 What happens now?",
            value:
              mode === "after_sessions"
                ? "• Current sessions will continue normally\n" +
                  "• Your license becomes private after all sessions end\n" +
                  "• No new sessions can be scheduled with your license\n" +
                  "• You can cancel this scheduled stop anytime"
                : "• Your license is no longer available to the community\n" +
                  "• Only your own instance can use your license\n" +
                  "• You have full control over your license usage\n" +
                  "• You can re-enable pooling anytime",
            inline: false,
          },
          {
            name: "🔄 Re-enable Later",
            value:
              "Use `/foundry user license-sharing` to re-enable pooling anytime",
            inline: true,
          },
        ])
        .setFooter({
          text:
            mode === "after_sessions"
              ? "License will become private after sessions end"
              : "Your license is now private",
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        components: [],
      });

      // Refresh stats to reflect the changes
      await refreshRegistrationStats();

      // If this was an immediate stop (not delayed), clean up the command channel
      // since the user no longer has an instance and license sharing is stopped
      if (mode === "immediate") {
        try {
          const guild = interaction.guild || client.guilds.cache.first();
          if (guild) {
            await deleteUserCommandChannel(guild, userId);
          }
        } catch (channelError) {
          console.log("Channel cleanup failed (non-critical):", channelError);
        }
      }
    } else {
      throw new Error(result.error || "Failed to disable license sharing");
    }
  } catch (error) {
    console.error("Error stopping license sharing:", error);
    await interaction.editReply({
      content: `❌ Failed to stop license sharing: ${error.message}`,
      components: [],
    });
  }
}

async function handleLicenseSharing(interaction, userId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Check if user has an instance
    const result = await invokeLambda({
      action: "status",
      userId: userId,
    });

    if (!result || result.status === "not_found") {
      return await interaction.editReply({
        content:
          "❌ You don't have a Foundry VTT instance. Please register one first using `/foundry user dashboard`.",
      });
    }

    // Check if user has a BYOL instance (only BYOL instances can share licenses)
    if (result.licenseType !== "byol") {
      return await interaction.editReply({
        content:
          "❌ Only BYOL (Bring Your Own License) instances can share licenses. Your instance uses a shared license from the community pool.",
      });
    }

    // Get current license sharing status
    const isCurrentlySharing = result.allowLicenseSharing || false;

    // Create embed explaining license sharing
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("🔑 License Sharing Management")
      .setDescription(
        isCurrentlySharing
          ? "Your license is currently **pooled with the community** and available for others to use."
          : "Your license is currently **private** and only used by your own instance."
      )
      .addFields([
        {
          name: "🤝 What is License Pooling?",
          value:
            "• Share your Foundry license with the community\n" +
            "• Others can schedule sessions using your license\n" +
            "• You get priority access to your own license\n" +
            "• Help others who don't have their own license",
          inline: false,
        },
        {
          name: "📋 Current Status",
          value: isCurrentlySharing
            ? "🟢 **License Pooled**"
            : "🔴 **License Private**",
          inline: true,
        },
        {
          name: "🎯 Your Priority",
          value:
            "You always get priority access to your own license, even when shared",
          inline: true,
        },
      ])
      .setFooter({
        text: isCurrentlySharing
          ? "Click 'Stop Pooling' to make your license private again"
          : "Click 'Start Pooling' to share your license with the community",
      })
      .setTimestamp();

    // Create action buttons
    const actionRow = new ActionRowBuilder().addComponents(
      isCurrentlySharing
        ? new ButtonBuilder()
            .setCustomId(`foundry_stop_sharing_${userId}`)
            .setLabel("Stop Pooling License")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🔒")
        : new ButtonBuilder()
            .setCustomId(`foundry_start_sharing_${userId}`)
            .setLabel("Start Pooling License")
            .setStyle(ButtonStyle.Success)
            .setEmoji("🤝"),
      new ButtonBuilder()
        .setCustomId(`foundry_license_sharing_cancel_${userId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("❌")
    );

    await interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    });
  } catch (error) {
    console.error("Error in handleLicenseSharing:", error);
    await interaction.editReply({
      content: `❌ Error managing license sharing: ${error.message}`,
    });
  }
}

async function handleLicenseSharingCancel(interaction, userId) {
  await interaction.deferUpdate();

  const embed = new EmbedBuilder()
    .setColor("#888888")
    .setTitle("❌ License Sharing Management Cancelled")
    .setDescription("No changes were made to your license sharing status.")
    .setFooter({
      text: "Use '/foundry user license-sharing' to manage sharing again",
    })
    .setTimestamp();

  await interaction.editReply({
    embeds: [embed],
    components: [],
  });
}

// Unified dashboard function that handles all instance display contexts

// ================================================================================
// UNIFIED DASHBOARD
// ================================================================================
async function sendUnifiedDashboard(
  channel,
  userId,
  status,
  context = "status"
) {
  // Get monthly cost data with supporter information
  let costData = null;
  try {
    const guild = channel.guild;
    costData = await getUserCostsWithSupporter(userId, guild);
  } catch (error) {
    console.log("Could not fetch cost data for unified dashboard:", error);
  }

  // Get license owner info for gratitude display on pooled instances
  let licenseOwnerInfo = null;
  if (status.licenseType === "pooled" && status.licenseOwnerId) {
    try {
      const adminResult = await invokeLambda({
        action: "admin-overview",
        userId: userId,
      });

      if (adminResult.licenses && adminResult.licenses.pools) {
        const licensePool = adminResult.licenses.pools.find(
          (pool) => pool.licenseId === status.licenseOwnerId
        );
        if (licensePool) {
          licenseOwnerInfo = licensePool.ownerUsername;
        }
      }
    } catch (error) {
      console.log("Could not fetch license owner info for unified dashboard");
    }
  }

  // Determine title and description based on context
  let title, description;
  switch (context) {
    case "created":
      title = "🎲 Your Foundry VTT Dashboard";
      description = "Your instance is ready!";
      break;
    case "running":
      title = "🎲 Instance Running";
      description = "Instance is running.";
      break;
    case "stopped":
      title = "🔴 Instance Stopped";
      description = "Instance is stopped.";
      break;
    case "sync":
      title = "🔄 Bot Restarted - Instance Synced";
      description = "Your instance has been synchronized after bot restart.";
      break;
    case "dashboard":
      title = "🎲 Your Foundry VTT Dashboard";
      description = "Current instance status and controls.";
      break;
    default:
      title = "🎲 Instance Status";
      description = `Current status: **${status.status}**`;
  }

  // Build the embed
  const embed = new EmbedBuilder()
    .setColor(status.status === "running" ? "#00ff00" : "#888888")
    .setTitle(title)
    .setDescription(description)
    .addFields([
      {
        name: "Status",
        value: `${getStatusEmoji(status.status)} ${status.status}`,
        inline: true,
      },
      {
        name: "License Type",
        value: status.licenseType === "byol" ? "🔑 BYOL" : "🤝 Pooled",
        inline: true,
      },
      {
        name: "Last Updated",
        value: `<t:${status.updatedAt}:R>`,
        inline: true,
      },
    ]);

  // Add URL if available
  if (status.url) {
    embed.addFields([{ name: "URL", value: status.url, inline: false }]);
  }

  // Add cost information
  if (costData) {
    embed.addFields([
      {
        name: "💰 This Month's Usage",
        value: `**${costData.hoursUsed.toFixed(
          1
        )}h** = $${costData.totalCost.toFixed(2)}`,
        inline: true,
      },
      ...(costData.isSupporter
        ? [
            {
              name: "🎖️ Supporter Discount",
              value: `$${costData.supporterAmount.toFixed(2)} monthly credit`,
              inline: true,
            },
            {
              name:
                costData.adjustedUncoveredCost > 0
                  ? "💸 Remaining Cost"
                  : "✅ Fully Covered",
              value:
                costData.adjustedUncoveredCost > 0
                  ? `$${costData.adjustedUncoveredCost.toFixed(2)}`
                  : "All costs covered! 🎉",
              inline: true,
            },
          ]
        : [
            {
              name:
                costData.uncoveredCost > 0
                  ? "💸 Uncovered Cost"
                  : "✅ Fully Covered",
              value:
                costData.uncoveredCost > 0
                  ? `$${costData.uncoveredCost.toFixed(2)}`
                  : "All costs covered! 🎉",
              inline: true,
            },
          ]),
      ...(costData.donationsReceived > 0
        ? [
            {
              name: "☕ Donations Received",
              value: `$${costData.donationsReceived.toFixed(2)}${
                costData.lastDonorName
                  ? ` (Latest: ${costData.lastDonorName})`
                  : ""
              }`,
              inline: true,
            },
          ]
        : []),
    ]);
  }

  // Add license owner info for pooled instances
  if (licenseOwnerInfo) {
    embed.addFields([
      {
        name: "🤝 License Pooled By",
        value: `Thanks to **${licenseOwnerInfo}** for pooling their license!`,
        inline: false,
      },
    ]);
  }

  // Add Foundry version info
  if (status.foundryVersion) {
    embed.addFields([
      {
        name: "Foundry Version",
        value: `\`felddy/foundryvtt:${status.foundryVersion}\``,
        inline: true,
      },
    ]);
  }

  // Add S3 bucket info
  if (status.s3BucketUrl) {
    embed.addFields([
      {
        name: "S3 Assets",
        value: `[Static Assets Bucket](${status.s3BucketUrl})`,
        inline: true,
      },
    ]);
  }

  // Add linked session info if running a scheduled session
  if (status.linkedSessionId && status.status === "running") {
    embed.addFields([
      {
        name: "🎮 Active Session",
        value: `Running scheduled session\nAuto-ends <t:${status.autoShutdownAt}:R>`,
        inline: true,
      },
    ]);
  }

  embed.setTimestamp();

  // Create user-focused control panel (General User and license related buttons)
  const userControlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_schedule_${userId}`)
      .setLabel("Schedule Session")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📅")
  );

  // Add license sharing management button for BYOL users
  if (status.licenseType === "byol") {
    userControlRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_license_sharing_${userId}`)
        .setLabel(
          status.allowLicenseSharing
            ? "Manage License Sharing"
            : "Start License Sharing"
        )
        .setStyle(
          status.allowLicenseSharing ? ButtonStyle.Primary : ButtonStyle.Success
        )
        .setEmoji(status.allowLicenseSharing ? "🔑" : "🤝")
    );
  }

  // Add Ko-fi donation button to user control row if there are remaining costs
  const remainingCost =
    costData?.adjustedUncoveredCost || costData?.uncoveredCost || 0;
  if (costData && remainingCost > 0 && process.env.KOFI_URL) {
    const suggestedAmount = Math.min(remainingCost, 5).toFixed(2);
    userControlRow.addComponents(
      new ButtonBuilder()
        .setURL(process.env.KOFI_URL)
        .setLabel(`☕ Cover $${suggestedAmount}`)
        .setStyle(ButtonStyle.Link)
        .setEmoji("💖")
    );
  }

  // Create instance-focused control panel (Instance-specific buttons only)
  const instanceControlRow = new ActionRowBuilder();

  if (status.licenseType === "pooled") {
    // Pooled instances get specialized buttons
    if (status.status === "running") {
      instanceControlRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_stop_${userId}`)
          .setLabel("Stop Instance")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("⏹️"),
        new ButtonBuilder()
          .setCustomId(`foundry_sessions_${userId}`)
          .setLabel("My Sessions")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("📋"),
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_adminkey_${userId}`)
          .setLabel("Get Admin Key")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔑"),
        new ButtonBuilder()
          .setCustomId(`foundry_destroy_${userId}`)
          .setLabel("Destroy")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("💀")
      );
    } else {
      // Pooled instances when not running
      instanceControlRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_sessions_${userId}`)
          .setLabel("My Sessions")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("📋"),
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_adminkey_${userId}`)
          .setLabel("Get Admin Key")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔑"),
        new ButtonBuilder()
          .setCustomId(`foundry_destroy_${userId}`)
          .setLabel("Destroy")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("💀")
      );
    }
  } else {
    // BYOL instances get different buttons based on status
    if (status.status === "stopped" || status.status === "created") {
      instanceControlRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_start_${userId}`)
          .setLabel("Start Instance")
          .setStyle(ButtonStyle.Success)
          .setEmoji("🚀"),
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_adminkey_${userId}`)
          .setLabel("Get Admin Key")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔑"),
        new ButtonBuilder()
          .setCustomId(`foundry_destroy_${userId}`)
          .setLabel("Destroy")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("💀")
      );
    } else if (status.status === "running") {
      instanceControlRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_stop_${userId}`)
          .setLabel("Stop Instance")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("⏹️"),
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId(`foundry_adminkey_${userId}`)
          .setLabel("Get Admin Key")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔑"),
        new ButtonBuilder()
          .setCustomId(`foundry_destroy_${userId}`)
          .setLabel("Destroy")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("💀")
      );
    } else {
      // Other statuses (starting, stopping, etc.)
      instanceControlRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`foundry_status_${userId}`)
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🔄")
      );
    }
  }

  // Add version selection dropdown for dashboard context
  let versionSelectRow = null;
  if (context === "dashboard") {
    const currentVersion = status.foundryVersion || "13";
    const versionLabels = {
      13: "v13 - Latest Stable",
      release: "Release - Current Stable",
      12: "v12 - Previous Major",
      11: "v11 - Legacy Major",
      "13.346.0": "v13.346.0 - Specific Build",
      latest: "Latest - Bleeding Edge",
    };

    versionSelectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`foundry_version_${userId}`)
        .setPlaceholder(
          `🔧 Current: ${versionLabels[currentVersion] || currentVersion}`
        )
        .addOptions([
          new StringSelectMenuOptionBuilder()
            .setLabel("v13 - Latest Stable (Recommended)")
            .setDescription("Auto-updates to newest v13 stable release")
            .setValue("13")
            .setEmoji("🏆"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Release - Current Stable")
            .setDescription("Latest tested and verified release")
            .setValue("release")
            .setEmoji("✅"),
          new StringSelectMenuOptionBuilder()
            .setLabel("v12 - Previous Major")
            .setDescription("Latest v12 release (downgrade option)")
            .setValue("12")
            .setEmoji("🔄"),
          new StringSelectMenuOptionBuilder()
            .setLabel("v11 - Legacy Major")
            .setDescription("Latest v11 release (legacy option)")
            .setValue("11")
            .setEmoji("📼"),
          new StringSelectMenuOptionBuilder()
            .setLabel("v13.346.0 - Specific Build")
            .setDescription("Fixed to exact v13.346.0 build")
            .setValue("13.346.0")
            .setEmoji("📌"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Latest - Bleeding Edge")
            .setDescription("Most recent build (may be unstable)")
            .setValue("latest")
            .setEmoji("⚡"),
        ])
    );
  }

  // Check if we have existing messages to update
  const existingDashboardId = client.userDashboardMessages?.get(userId);
  const existingStatusId = client.userStatusMessages.get(userId);
  let dashboardMessage, statusMessage;

  // Send/Update FIRST MESSAGE: Unified Dashboard (General User and license related buttons)
  const dashboardComponents = [userControlRow];
  if (versionSelectRow) {
    dashboardComponents.push(versionSelectRow);
  }

  if (existingDashboardId) {
    try {
      const existingMessage = await channel.messages.fetch(existingDashboardId);
      dashboardMessage = await existingMessage.edit({
        embeds: [embed],
        components: dashboardComponents,
        content:
          context === "created"
            ? `<@${userId}> Your Foundry VTT instance is ready!`
            : null,
      });
    } catch (error) {
      console.log(
        `Could not update existing dashboard message for ${userId}, sending new one:`,
        error.message
      );
      dashboardMessage = await channel.send({
        embeds: [embed],
        components: dashboardComponents,
        content:
          context === "created"
            ? `<@${userId}> Your Foundry VTT instance is ready!`
            : null,
      });
      if (!client.userDashboardMessages)
        client.userDashboardMessages = new Map();
      client.userDashboardMessages.set(userId, dashboardMessage.id);
    }
  } else {
    dashboardMessage = await channel.send({
      embeds: [embed],
      components: dashboardComponents,
      content:
        context === "created"
          ? `<@${userId}> Your Foundry VTT instance is ready!`
          : null,
    });
    if (!client.userDashboardMessages) client.userDashboardMessages = new Map();
    client.userDashboardMessages.set(userId, dashboardMessage.id);
  }

  // Send/Update SECOND MESSAGE: Instance Status (Instance-specific buttons only)
  const statusEmbed = new EmbedBuilder()
    .setColor(status.status === "running" ? "#00ff00" : "#888888")
    .setTitle(`${getStatusEmoji(status.status)} Instance Status`)
    .setDescription(`Current status: **${status.status}**`)
    .addFields([
      {
        name: "Last Updated",
        value: `<t:${status.updatedAt}:R>`,
        inline: true,
      },
      ...(costData
        ? [
            {
              name: "💰 This Month",
              value: `${costData.hoursUsed.toFixed(
                1
              )}h = $${costData.totalCost.toFixed(2)}${
                costData.uncoveredCost > 0
                  ? ` (💸$${costData.uncoveredCost.toFixed(2)} uncovered)`
                  : " ✅"
              }`,
              inline: true,
            },
          ]
        : []),
      ...(licenseOwnerInfo
        ? [
            {
              name: "🤝 License Pooled By",
              value: `Thanks to **${licenseOwnerInfo}** for pooling their license!`,
              inline: false,
            },
          ]
        : []),
    ])
    .setTimestamp();

  if (existingStatusId) {
    try {
      const existingMessage = await channel.messages.fetch(existingStatusId);
      statusMessage = await existingMessage.edit({
        embeds: [statusEmbed],
        components: [instanceControlRow],
      });
    } catch (error) {
      console.log(
        `Could not update existing status message for ${userId}, sending new one:`,
        error.message
      );
      statusMessage = await channel.send({
        embeds: [statusEmbed],
        components: [instanceControlRow],
      });
      client.userStatusMessages.set(userId, statusMessage.id);
    }
  } else {
    statusMessage = await channel.send({
      embeds: [statusEmbed],
      components: [instanceControlRow],
    });
    client.userStatusMessages.set(userId, statusMessage.id);
  }

  // Return the dashboard message for compatibility
  const sentMessage = dashboardMessage;

  // Refresh stats after state change for certain contexts
  if (context === "created" || context === "running") {
    await refreshRegistrationStats();
  }

  return sentMessage;
}

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
