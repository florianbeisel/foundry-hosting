const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { ADMIN_CATEGORY_ID, ADMIN_ROLE_ID } = require("../config/constants");
const { sanitizeUsername } = require("./formatting");

/**
 * Create a user command channel
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {string} username
 * @returns {Promise<import('discord.js').TextChannel>}
 */
async function createUserCommandChannel(guild, userId, username) {
  const sanitizedUsername = sanitizeUsername(username);
  const channelName = `foundry-${sanitizedUsername}-${userId.slice(-4)}`;

  // Check if channel already exists
  const existingChannel = guild.channels.cache.find(
    (ch) => ch.name === channelName
  );
  if (existingChannel) {
    return existingChannel;
  }

  // Get admin role overwrites
  const adminOverwrites = getAdminRoleOverwrites(guild);

  // Create the channel
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: ADMIN_CATEGORY_ID,
    topic: `Foundry VTT control panel for ${username} (${userId})`,
    permissionOverwrites: [
      {
        id: guild.id, // @everyone
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
      ...adminOverwrites,
    ],
  });

  console.log(`Created command channel: ${channel.name}`);
  return channel;
}

/**
 * Delete a user command channel
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
async function deleteUserCommandChannel(client, guild, userId) {
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

/**
 * Get admin role permission overwrites
 * @param {import('discord.js').Guild} guild
 * @returns {Array}
 */
function getAdminRoleOverwrites(guild) {
  const adminRole = guild.roles.cache.get(ADMIN_ROLE_ID);
  if (!adminRole) {
    console.warn("Admin role not found!");
    return [];
  }

  return [
    {
      id: ADMIN_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];
}

/**
 * Send a message to a channel with error handling
 * @param {import('discord.js').TextChannel} channel
 * @param {Object} messageOptions
 * @param {Function} fallbackChannelCreation
 * @returns {Promise<import('discord.js').Message>}
 */
async function sendMessageSafely(channel, messageOptions, fallbackChannelCreation = null) {
  try {
    // Check if we have permission to send messages
    if (channel.guild) {
      const me = channel.guild.members.me;
      if (!channel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
        console.error(
          `Missing permission to send messages in channel ${channel.name}`
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

module.exports = {
  createUserCommandChannel,
  deleteUserCommandChannel,
  getAdminRoleOverwrites,
  sendMessageSafely,
};