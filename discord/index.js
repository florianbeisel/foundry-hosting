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
client.commands.set(foundryCommand.data.name, foundryCommand);

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
  }, 15000); // Check every 15 seconds

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
  const embed = new EmbedBuilder()
    .setColor("#00ff00")
    .setTitle("🎲 Instance Running")
    .setDescription("Instance is running.")
    .addFields([
      { name: "Status", value: "🟢 Running", inline: true },
      { name: "URL", value: status.url || "URL not available", inline: false },
      { name: "Started", value: `<t:${status.updatedAt}:R>`, inline: true },
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
                name: "Last Updated",
                value: `<t:${instance.updatedAt}:R>`,
                inline: true,
              },
            ])
            .setTimestamp();

          // Create consistent action buttons for all statuses
          const syncActionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`foundry_status_${instance.userId}`)
              .setLabel("Refresh Status")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("🔄")
          );

          if (instance.status === "stopped" || instance.status === "created") {
            syncActionRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`foundry_start_${instance.userId}`)
                .setLabel("Start Instance")
                .setStyle(ButtonStyle.Success)
                .setEmoji("🚀")
            );
          }

          // Add destroy button for stopped and created instances
          if (instance.status === "stopped" || instance.status === "created") {
            syncActionRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`foundry_destroy_${instance.userId}`)
                .setLabel("Destroy")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("💀")
            );
          }

          if (instance.status === "running") {
            syncActionRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`foundry_stop_${instance.userId}`)
                .setLabel("Stop Instance")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("⏹️")
            );
          }

          await channel.send({
            embeds: [welcomeEmbed],
            components: [syncActionRow],
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
    await handleButtonInteraction(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenuInteraction(interaction);
  } else if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
  }
});

async function handleSlashCommand(interaction) {
  if (!hasRequiredRole(interaction.member)) {
    return await interaction.reply({
      content: "❌ You do not have permission to use Foundry commands.",
      ephemeral: true,
    });
  }

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    interaction.invokeLambda = invokeLambda;
    interaction.hasAdminRole = () => hasAdminRole(interaction.member);
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
    // Format: foundry_action_confirm_userId
    confirmAction = parts[2];
    userId = parts[3];
  } else {
    return;
  }

  // Handle registration buttons immediately (modals can't be shown after deferring)
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

  // Check if user can interact with this button
  if (userId !== interaction.user.id && !hasAdminRole(interaction.member)) {
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
  // Create modal for credential input
  const credentialsModal = new ModalBuilder()
    .setCustomId(`foundry_credentials_${userId}`)
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

async function handleModalSubmit(interaction) {
  if (interaction.customId.startsWith("foundry_credentials_")) {
    await handleCredentialsModal(interaction);
  }
}

async function handleCredentialsModal(interaction) {
  const userId = interaction.customId.split("_")[2];

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
    });

    // Create user command channel
    const channel = await createUserCommandChannel(
      interaction.guild,
      userId,
      user.username
    );

    const successEmbed = new EmbedBuilder()
      .setColor("#00ff00")
      .setTitle("✅ Instance Created")
      .setDescription(`Command channel: ${channel}`)
      .addFields([
        { name: "Status", value: "⚪ Created", inline: true },
        {
          name: "Your URL",
          value: result.url || "Available after startup",
          inline: true,
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
          value: 'Click "Start Instance" to begin',
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

    const actionRow = new ActionRowBuilder().addComponents(
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

    await user.send({
      embeds: [successEmbed, adminKeyEmbed],
      components: [actionRow],
    });
    await channel.send({
      content: `<@${userId}> Instance ready.`,
      embeds: [successEmbed],
      components: [actionRow],
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
  // For safety, require confirmation in a follow-up
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

async function handleDestroyConfirmButton(interaction, userId) {
  const result = await invokeLambda({
    action: "destroy",
    userId: userId,
  });

  const embed = new EmbedBuilder()
    .setColor("#ff0000")
    .setTitle("💀 Instance Destroyed")
    .setDescription("Instance destroyed.")
    .addFields([
      { name: "Status", value: "🗑️ Destroyed", inline: true },
      {
        name: "Data",
        value: "All data deleted",
        inline: true,
      },
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

  // Clean up user channel
  if (interaction.guild) {
    await deleteUserCommandChannel(interaction.guild, userId);
  }
}

async function handleDestroyCancelButton(interaction, userId) {
  const embed = new EmbedBuilder()
    .setColor("#00ff00")
    .setTitle("✅ Destruction Cancelled")
    .setDescription("Instance not destroyed.")
    .setTimestamp();

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

  const menuType = parts[1];
  const userId = parts[2];

  // Check if user can interact with this menu
  if (userId !== interaction.user.id && !hasAdminRole(interaction.member)) {
    return await interaction.reply({
      content: "❌ You can only control your own instance.",
      ephemeral: true,
    });
  }

  if (menuType === "version") {
    await handleVersionSelection(interaction, userId);
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

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
