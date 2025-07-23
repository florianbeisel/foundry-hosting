const { invokeLambda } = require("./lambdaService");
const { sendUnifiedDashboard } = require("../ui/dashboardService");
const { clearChannelMessages } = require("../utils/channelUtils");

async function syncAllInstances(client) {
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
          user.username,
          client
        );

        if (channel) {
          // Update our cache
          client.userChannels.set(instance.userId, channel.id);

          // Clear ALL messages from the command channel for visibility
          await clearChannelMessages(channel);

          // Clear stored message ID since we cleared the channel
          client.userStatusMessages.delete(instance.userId);

          // Use unified dashboard for all instances
          await sendUnifiedDashboard(
            channel,
            instance.userId,
            instance,
            "sync",
            client
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

async function findExistingCommandChannel(guild, userId, username, client) {
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

module.exports = {
  syncAllInstances,
  findExistingCommandChannel,
};