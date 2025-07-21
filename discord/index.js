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
} = require("discord.js");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const cron = require("node-cron");

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize AWS Lambda client
const lambda = new LambdaClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// Store commands and active monitoring
client.commands = new Collection();
client.userChannels = new Map(); // userId -> channelId
client.statusMonitors = new Map(); // userId -> interval

// Import commands
const foundryCommand = require("./commands/foundry");
const adminCommand = require("./commands/admin");
client.commands.set(foundryCommand.data.name, foundryCommand);
client.commands.set(adminCommand.data.name, adminCommand);

// Helper function to sanitize Discord username for URL use
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
  const statusEmojis = {
    running: "🟢",
    starting: "🟡",
    stopping: "🟠",
    stopped: "🔴",
    created: "⚪",
    unknown: "❔",
  };
  return statusEmojis[status] || "❔";
}

// Helper function to find existing command channel for a user
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

// Helper functions for permissions and channels
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
    } catch (error) {
      console.error("Error deleting user channel:", error);
    }
  }
}

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
  }, 20000); // Check every 20 seconds (optimized from 15s to reduce Lambda invocations)

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
  const statusEmoji = {
    running: "🟢",
    starting: "🟡",
    stopping: "🟠",
    stopped: "🔴",
    created: "⚪",
    unknown: "❔",
  };

  // Get license owner info for gratitude display on pooled instances
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
      console.log("Could not fetch license owner info for status display");
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
      ...(licenseOwnerInfo
        ? [
            {
              name: "🤝 License Shared By",
              value: `Thanks to **${licenseOwnerInfo}** for sharing their license!`,
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

  await channel.send({ embeds: [embed] });
}

async function sendInstanceControlPanel(channel, userId, status) {
  // Get license owner info for gratitude display
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
      console.log("Could not fetch license owner info for gratitude display");
    }
  }

  const embed = new EmbedBuilder()
    .setColor("#00ff00")
    .setTitle("🎲 Instance Running")
    .setDescription("Instance is running.")
    .addFields([
      { name: "Status", value: "🟢 Running", inline: true },
      { name: "URL", value: status.url || "URL not available", inline: false },
      { name: "Started", value: `<t:${status.updatedAt}:R>`, inline: true },
      ...(licenseOwnerInfo
        ? [
            {
              name: "🤝 License Shared By",
              value: `Thanks to **${licenseOwnerInfo}** for sharing their license!`,
              inline: false,
            },
          ]
        : []),
      ...(status.foundryVersion
        ? [
            {
              name: "Foundry Version",
              value: `\`felddy/foundryvtt:${status.foundryVersion}\``,
              inline: true,
            },
          ]
        : []),
      ...(status.s3BucketUrl
        ? [
            {
              name: "S3 Assets",
              value: `[Static Assets Bucket](${status.s3BucketUrl})`,
              inline: true,
            },
          ]
        : []),
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
      .setLabel("Destroy Instance")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("💀")
  );

  await channel.send({
    embeds: [embed],
    components: [actionRow],
    content: `<@${userId}> Your Foundry VTT instance is ready!`,
  });
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

          // Send a welcome message to indicate bot restart and sync
          const welcomeEmbed = new EmbedBuilder()
            .setColor("#00ff00")
            .setTitle("🔄 Bot Restarted - Instance Synced")
            .setDescription(
              `Welcome back! Your Foundry VTT instance has been synchronized.`
            )
            .addFields([
              {
                name: "Status",
                value: `${getStatusEmoji(instance.status)} ${instance.status}`,
                inline: true,
              },
              {
                name: "License Type",
                value: licenseDisplay,
                inline: true,
              },
              {
                name: "Last Updated",
                value: `<t:${instance.updatedAt}:R>`,
                inline: true,
              },
              {
                name: "Your URL",
                value: instance.url || "Available after startup",
                inline: false,
              },
              {
                name: "Foundry Version",
                value: `\`felddy/foundryvtt:${
                  instance.foundryVersion || "13"
                }\``,
                inline: true,
              },
              ...(licenseType === "pooled"
                ? [
                    {
                      name: "Access Rules",
                      value:
                        "⚠️ Schedule-only access - optimal license assigned automatically",
                      inline: true,
                    },
                  ]
                : []),
              ...(licenseOwnerInfo
                ? [
                    {
                      name: "🤝 License Shared By",
                      value: `Thanks to **${licenseOwnerInfo}** for sharing their license!`,
                      inline: false,
                    },
                  ]
                : []),
            ])
            .setTimestamp();

          // Create action buttons based on license type and status
          let actionRow, destroyRow;

          if (licenseType === "pooled") {
            // Pooled instances get specialized buttons
            actionRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`foundry_schedule_${instance.userId}`)
                .setLabel("Schedule Session")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("📅"),
              new ButtonBuilder()
                .setCustomId(`foundry_sessions_${instance.userId}`)
                .setLabel("My Sessions")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("📋"),
              new ButtonBuilder()
                .setCustomId(`foundry_status_${instance.userId}`)
                .setLabel("Check Status")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🔄"),
              new ButtonBuilder()
                .setCustomId(`foundry_adminkey_${instance.userId}`)
                .setLabel("Get Admin Key")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🔑")
            );

            destroyRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`foundry_destroy_${instance.userId}`)
                .setLabel("Destroy")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("💀")
            );
          } else {
            // BYOL instances get different buttons based on status
            actionRow = new ActionRowBuilder();

            if (
              instance.status === "stopped" ||
              instance.status === "created"
            ) {
              actionRow.addComponents(
                new ButtonBuilder()
                  .setCustomId(`foundry_start_${instance.userId}`)
                  .setLabel("Start Instance")
                  .setStyle(ButtonStyle.Success)
                  .setEmoji("🚀"),
                new ButtonBuilder()
                  .setCustomId(`foundry_schedule_${instance.userId}`)
                  .setLabel("Schedule Session")
                  .setStyle(ButtonStyle.Primary)
                  .setEmoji("📅"),
                new ButtonBuilder()
                  .setCustomId(`foundry_status_${instance.userId}`)
                  .setLabel("Check Status")
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji("🔄"),
                new ButtonBuilder()
                  .setCustomId(`foundry_adminkey_${instance.userId}`)
                  .setLabel("Get Admin Key")
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji("🔑")
              );

              destroyRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`foundry_destroy_${instance.userId}`)
                  .setLabel("Destroy")
                  .setStyle(ButtonStyle.Danger)
                  .setEmoji("💀")
              );
            } else if (instance.status === "running") {
              actionRow.addComponents(
                new ButtonBuilder()
                  .setCustomId(`foundry_stop_${instance.userId}`)
                  .setLabel("Stop Instance")
                  .setStyle(ButtonStyle.Danger)
                  .setEmoji("⏹️"),
                new ButtonBuilder()
                  .setCustomId(`foundry_status_${instance.userId}`)
                  .setLabel("Refresh Status")
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji("🔄"),
                new ButtonBuilder()
                  .setCustomId(`foundry_adminkey_${instance.userId}`)
                  .setLabel("Get Admin Key")
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji("🔑")
              );

              destroyRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`foundry_destroy_${instance.userId}`)
                  .setLabel("Destroy")
                  .setStyle(ButtonStyle.Danger)
                  .setEmoji("💀")
              );
            } else {
              // Other statuses (starting, stopping, etc.)
              actionRow.addComponents(
                new ButtonBuilder()
                  .setCustomId(`foundry_status_${instance.userId}`)
                  .setLabel("Refresh Status")
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji("🔄")
              );
            }
          }

          await channel.send({
            embeds: [welcomeEmbed],
            components: destroyRow ? [actionRow, destroyRow] : [actionRow],
          });

          // Post current status with consistent controls
          if (instance.status === "running") {
            await sendInstanceControlPanel(channel, instance.userId, instance);
          } else {
            await sendStatusUpdate(channel, instance);
          }

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

// Bot ready event
client.once("ready", async () => {
  console.log(`✅ Foundry VTT Bot is ready! Logged in as ${client.user.tag}`);
  console.log(`📋 Registered in ${client.guilds.cache.size} servers`);

  client.user.setActivity("Foundry VTT instances", { type: "WATCHING" });

  // Clean up any orphaned status monitors on restart
  client.statusMonitors.clear();

  // Sync all running instances
  await syncAllInstances();
});

// Error handling
client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

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
    interaction.hasAdminRole = () =>
      interaction.guild ? hasAdminRole(interaction.member) : false;
    interaction.createUserCommandChannel = (userId, username) =>
      createUserCommandChannel(interaction.guild, userId, username);
    interaction.deleteUserCommandChannel = (userId) =>
      deleteUserCommandChannel(interaction.guild, userId);
    interaction.startStatusMonitoring = startStatusMonitoring;

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
      subAction === "stop" ||
      subAction === "use" ||
      subAction === "create" ||
      subAction === "destroy"
    ) {
      // Format: foundry_reregister_byol_userId, foundry_stop_sharing_userId, foundry_use_pooled_userId, foundry_create_pooled_userId
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
        if (confirmAction === "confirm") {
          await handleDestroyConfirmButton(interaction, userId);
        } else if (confirmAction === "cancel") {
          await handleDestroyCancelButton(interaction, userId);
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
          "• Use your own Foundry license\n• Start instances on-demand\n• Can share license with community",
        inline: false,
      },
      {
        name: "🌐 Pooled (Smart License Assignment)",
        value:
          availablePools.length > 0
            ? `• Automatically assigns best available license\n• Schedule sessions in advance\n• **Prioritizes your own license if shared**\n• **${availablePools.length} license(s) available**`
            : "• Automatically assigns best available license\n• Schedule sessions in advance\n• **Prioritizes your own license if shared**\n• ⚠️ **No shared licenses currently available**",
        inline: false,
      },
    ])
    .setFooter({ text: "Choose your preferred license type below" });

  const selectOptions = [
    {
      label: "BYOL - Own License",
      description: "I have my own Foundry license and want on-demand access",
      value: "byol_no_share",
      emoji: "🔐",
    },
    {
      label: "BYOL - Own License + Share",
      description: "I have my own license and want to share it with others",
      value: "byol_share",
      emoji: "🤝",
    },
  ];

  // Only add pooled option if licenses are available
  if (availablePools.length > 0) {
    selectOptions.push({
      label: "Pooled - Smart License Assignment",
      description: `Auto-assigns best license, prioritizes your own (${availablePools.length} available)`,
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
  } else {
    await interaction.reply({
      content: "❌ Unknown admin action.",
      ephemeral: true,
    });
  }
}

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

    await user.send({
      embeds: [successEmbed, adminKeyEmbed],
      components: [actionRow, destroyRow],
    });
    await channel.send({
      content: `<@${userId}> Instance ready.`,
      embeds: [successEmbed],
      components: [actionRow, destroyRow],
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

      // Wait 30 seconds before starting status monitoring to give the instance time to initialize
      setTimeout(() => {
        startStatusMonitoring(userId, channelId);
      }, 30000);
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

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_start_${userId}`)
      .setLabel("Start Instance")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🚀"),
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
}

async function handleStatusButton(interaction, userId) {
  const result = await invokeLambda({
    action: "status",
    userId: userId,
  });

  if (result.status === "running") {
    await sendInstanceControlPanel(interaction.channel, userId, result);
  } else {
    await sendStatusUpdate(interaction.channel, result);
  }

  await interaction.editReply({ content: "🔄 Status refreshed above." });
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

    // Clean up user channel (get guild from client since DM interactions don't have guild)
    try {
      const guild = interaction.guild || client.guilds.cache.first();
      if (guild) {
        await deleteUserCommandChannel(guild, userId);
      }
    } catch (channelError) {
      console.log("Channel cleanup failed (non-critical):", channelError);
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

    // Clean up user channel (get guild from client since DM interactions don't have guild)
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

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
