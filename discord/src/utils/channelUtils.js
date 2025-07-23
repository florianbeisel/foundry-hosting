const { ChannelType, PermissionFlagsBits } = require("discord.js");

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

async function createUserCommandChannel(guild, userId, username, client) {
  const channelName = `foundry-${sanitizeUsername(username)}-${userId.slice(-4)}`;

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

function sanitizeUsername(username) {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-") // Replace non-alphanumeric chars with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .substring(0, 32); // Limit length for ALB target group name constraints
}

async function safeChannelSend(
  channel,
  messageOptions,
  fallbackChannelCreation = null
) {
  try {
    // Check if the bot has permission to send messages in this channel
    if (channel.guild) {
      const botMember = await channel.guild.members.fetch(channel.client.user.id);
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

module.exports = {
  clearChannelMessages,
  createUserCommandChannel,
  sanitizeUsername,
  safeChannelSend,
};