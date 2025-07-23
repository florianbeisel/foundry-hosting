const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

// Status emoji mapping
const STATUS_EMOJIS = {
  running: "🟢",
  starting: "🟡", 
  stopping: "🟠",
  stopped: "🔴",
  created: "⚪",
  unknown: "❔",
};

async function sendUnifiedDashboard(channel, userId, status, context, client) {
  console.log(`📊 Sending dashboard for user ${userId} in context: ${context}`);
  
  try {
    const embed = new EmbedBuilder()
      .setColor(status.status === "running" ? "#00ff00" : "#888888")
      .setTitle("🎲 Foundry VTT Instance Dashboard")
      .setDescription(`${STATUS_EMOJIS[status.status]} Status: **${status.status}**`)
      .addFields([
        { 
          name: "User", 
          value: `<@${userId}>`, 
          inline: true 
        },
        { 
          name: "Last Updated", 
          value: status.updatedAt ? `<t:${status.updatedAt}:R>` : "Unknown", 
          inline: true 
        },
        {
          name: "Context",
          value: context,
          inline: true
        }
      ])
      .setTimestamp();

    // Add URL if running
    if (status.url && status.status === "running") {
      embed.addFields([
        {
          name: "🌐 Access URL",
          value: status.url,
          inline: false
        }
      ]);
    }

    // Create action buttons based on status
    const components = createActionButtons(userId, status);

    await channel.send({
      embeds: [embed],
      components: components
    });

  } catch (error) {
    console.error("Error sending unified dashboard:", error);
    
    // Fallback message
    await channel.send({
      content: `⚠️ Dashboard error for user <@${userId}>: ${error.message}`
    });
  }
}

function createActionButtons(userId, status) {
  const actionRows = [];
  
  // Main control buttons
  const mainRow = new ActionRowBuilder();
  
  if (status.status === "stopped" || status.status === "created") {
    mainRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_start_${userId}`)
        .setLabel("Start Instance")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🚀")
    );
  }
  
  if (status.status === "running") {
    mainRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`foundry_stop_${userId}`)
        .setLabel("Stop Instance")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("⏹️")
    );
  }
  
  // Always available buttons
  mainRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_status_${userId}`)
      .setLabel("Refresh Status")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄")
  );

  if (mainRow.components.length > 0) {
    actionRows.push(mainRow);
  }

  // Secondary buttons
  const secondaryRow = new ActionRowBuilder();
  
  secondaryRow.addComponents(
    new ButtonBuilder()
      .setCustomId(`foundry_sessions_${userId}`)
      .setLabel("My Sessions")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📅"),
    new ButtonBuilder()
      .setCustomId(`foundry_adminkey_${userId}`)
      .setLabel("Admin Key")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔑")
  );

  if (secondaryRow.components.length > 0) {
    actionRows.push(secondaryRow);
  }

  return actionRows;
}

module.exports = {
  sendUnifiedDashboard,
};