const { EmbedBuilder } = require("discord.js");
const { invokeLambda } = require("../services/lambdaService");
const { sendUnifiedDashboard } = require("../ui/dashboardService");

async function handleButtonInteraction(interaction, client) {
  const parts = interaction.customId.split("_");
  const [action, subAction] = parts;

  if (action !== "foundry") return;

  console.log(`🔘 Foundry button interaction: ${interaction.customId}`);

  // Extract userId from button ID
  let userId;
  if (parts.length === 3) {
    userId = parts[2]; // foundry_action_userId
  } else if (parts.length === 4) {
    userId = parts[3]; // foundry_action_detail_userId
  }

  // Check if user can interact with this button
  if (userId !== interaction.user.id) {
    return await interaction.reply({
      content: "❌ You can only control your own instance.",
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    switch (subAction) {
      case "start":
        await handleStartButton(interaction, userId, client);
        break;
      case "stop":
        await handleStopButton(interaction, userId, client);
        break;
      case "status":
        await handleStatusButton(interaction, userId, client);
        break;
      case "sessions":
        await handleSessionsButton(interaction, userId, client);
        break;
      case "adminkey":
        await handleAdminKeyButton(interaction, userId, client);
        break;
      default:
        await interaction.editReply({ 
          content: `🚧 Button "${subAction}" not yet implemented in refactored version` 
        });
    }
  } catch (error) {
    console.error("Button interaction error:", error);
    await interaction.editReply({
      content: `❌ Error: ${error.message}`,
    });
  }
}

async function handleStartButton(interaction, userId, client) {
  try {
    console.log(`🚀 Starting instance for user ${userId}`);
    
    const result = await invokeLambda({
      action: "start",
      userId: userId,
    });

    await interaction.editReply({
      content: `🚀 Instance starting! This may take 2-3 minutes.\n\nURL: ${result.url || "Will be available shortly"}`,
    });

    // Update dashboard in user's channel if available
    const channelId = client.userChannels.get(userId);
    if (channelId) {
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        await sendUnifiedDashboard(channel, userId, { 
          status: "starting", 
          url: result.url,
          updatedAt: Math.floor(Date.now() / 1000)
        }, "start", client);
      }
    }

  } catch (error) {
    await interaction.editReply({
      content: `❌ Failed to start instance: ${error.message}`,
    });
  }
}

async function handleStopButton(interaction, userId, client) {
  try {
    console.log(`⏹️ Stopping instance for user ${userId}`);
    
    const result = await invokeLambda({
      action: "stop",
      userId: userId,
    });

    await interaction.editReply({
      content: `⏹️ Instance stopped successfully.`,
    });

    // Update dashboard
    const channelId = client.userChannels.get(userId);
    if (channelId) {
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        await sendUnifiedDashboard(channel, userId, { 
          status: "stopped",
          updatedAt: Math.floor(Date.now() / 1000)
        }, "stop", client);
      }
    }

  } catch (error) {
    await interaction.editReply({
      content: `❌ Failed to stop instance: ${error.message}`,
    });
  }
}

async function handleStatusButton(interaction, userId, client) {
  try {
    console.log(`🔄 Checking status for user ${userId}`);
    
    const result = await invokeLambda({
      action: "status",
      userId: userId,
    });

    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("📊 Instance Status")
      .setDescription(`Current status: **${result.status}**`)
      .addFields([
        { 
          name: "Last Updated", 
          value: `<t:${result.updatedAt}:R>`, 
          inline: true 
        }
      ])
      .setTimestamp();

    if (result.url && result.status === "running") {
      embed.addFields([
        {
          name: "🌐 Access URL",
          value: result.url,
          inline: false
        }
      ]);
    }

    await interaction.editReply({
      embeds: [embed],
    });

  } catch (error) {
    await interaction.editReply({
      content: `❌ Failed to check status: ${error.message}`,
    });
  }
}

async function handleSessionsButton(interaction, userId, client) {
  await interaction.editReply({
    content: "📅 Sessions management not yet implemented in refactored version",
  });
}

async function handleAdminKeyButton(interaction, userId, client) {
  try {
    console.log(`🔑 Getting admin key for user ${userId}`);
    
    const result = await invokeLambda({
      action: "get-admin-key",
      userId: userId,
    });

    // Send admin key via DM
    const user = await client.users.fetch(userId);
    const embed = new EmbedBuilder()
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

    await user.send({ embeds: [embed] });

    await interaction.editReply({
      content: "🔑 Admin key sent to your DMs!",
    });

  } catch (error) {
    await interaction.editReply({
      content: `❌ Failed to get admin key: ${error.message}`,
    });
  }
}

module.exports = {
  handleButtonInteraction,
};