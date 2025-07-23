const { ActivityType } = require("discord.js");
const { 
  loadRegistrationStatsMappingFromDB, 
  saveRegistrationStatsMappingToDB,
  loadAdminStatusMappingFromDB 
} = require("../services/dynamodb");
const { invokeFoundryLambda } = require("../services/lambda");
const { ADMIN_CATEGORY_ID } = require("../config/constants");

/**
 * Handle the ready event
 * @param {import('discord.js').Client} client
 */
async function handleReady(client) {
  console.log(`✅ Foundry VTT Bot is ready! Logged in as ${client.user.tag}`);
  console.log(`📋 Registered in ${client.guilds.cache.size} servers`);

  client.user.setActivity("Foundry VTT instances", { 
    type: ActivityType.Watching 
  });

  // Setup logging channel
  await setupLoggingChannel(client);

  // Clean up any orphaned status monitors on restart
  client.statusMonitors.clear();

  // Restore and validate registration stats mapping from DB
  const botConfigTableName = process.env.BOT_CONFIG_TABLE_NAME;
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

  // Sync all instances
  await syncAllInstances(client);

  // Schedule periodic updates
  schedulePeriodicUpdates(client);
}

/**
 * Setup the logging channel
 * @param {import('discord.js').Client} client
 */
async function setupLoggingChannel(client) {
  const loggingChannelId = process.env.LOGGING_CHANNEL_ID;
  if (!loggingChannelId) return;

  try {
    const channel = await client.channels.fetch(loggingChannelId);
    if (channel && channel.isTextBased()) {
      client.loggingChannel = channel;
      console.log(`📝 Logging channel set to: ${channel.name}`);
    }
  } catch (error) {
    console.error("Failed to setup logging channel:", error);
  }
}

/**
 * Sync all instances on startup
 * @param {import('discord.js').Client} client
 */
async function syncAllInstances(client) {
  console.log("🔄 Syncing all instances on startup...");

  try {
    // Get all instances from Lambda
    const result = await invokeFoundryLambda({
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
          // Update cache
          client.userChannels.set(instance.userId, channel.id);
          console.log(
            `Restored channel mapping for ${user.username}: ${channel.id}`
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

/**
 * Find existing command channel for a user
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {string} username
 * @returns {Promise<import('discord.js').TextChannel|null>}
 */
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

  return channel;
}

/**
 * Schedule periodic updates
 * @param {import('discord.js').Client} client
 */
function schedulePeriodicUpdates(client) {
  // Schedule registration stats update every 5 minutes
  setInterval(async () => {
    try {
      await updateRegistrationStats(client);
    } catch (error) {
      console.error("Error updating registration stats:", error);
    }
  }, 5 * 60 * 1000);

  // Schedule admin status update every 2 minutes
  setInterval(async () => {
    try {
      await updateAdminStatus(client);
    } catch (error) {
      console.error("Error updating admin status:", error);
    }
  }, 2 * 60 * 1000);
}

// Placeholder functions - these would be imported from other modules
async function updateRegistrationStats(client) {
  // Implementation would be in a separate module
}

async function updateAdminStatus(client) {
  // Implementation would be in a separate module
}

module.exports = {
  handleReady,
  setupLoggingChannel,
  syncAllInstances,
  findExistingCommandChannel,
};