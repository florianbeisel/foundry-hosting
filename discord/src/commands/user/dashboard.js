const { EmbedBuilder, MessageFlags } = require("discord.js");

const { sendUnifiedDashboard } = require("../../ui/dashboardService");
const { createUserCommandChannel } = require("../../utils/channelUtils");

async function handleDashboard(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Check if user has an instance
    const result = await interaction.invokeLambda({
      action: "status",
      userId: interaction.user.id,
    });

    // User has an instance - show full dashboard
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("🎲 Your Foundry VTT Dashboard")
      .setDescription(`Instance Status: **${result.status}**`)
      .addFields([
        { name: "User", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Username", value: interaction.user.username, inline: true },
        { name: "Last Updated", value: result.updatedAt ? `<t:${result.updatedAt}:R>` : "Unknown", inline: true },
      ]);

    if (result.url && result.status === "running") {
      embed.addFields([
        {
          name: "🌐 Access URL",
          value: result.url,
          inline: false
        }
      ]);
    }

    if (result.foundryVersion) {
      embed.addFields([
        {
          name: "Foundry Version",
          value: `\`${result.foundryVersion}\``,
          inline: true
        }
      ]);
    }

    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // If user has a command channel, also update it
    const channelId = interaction.client.userChannels.get(interaction.user.id);
    if (channelId) {
      const channel = interaction.client.channels.cache.get(channelId);
      if (channel) {
        await sendUnifiedDashboard(channel, interaction.user.id, result, "dashboard", interaction.client);
      }
    } else if (interaction.guild) {
      // Try to create a command channel for the user
      try {
        const channel = await createUserCommandChannel(
          interaction.guild, 
          interaction.user.id, 
          interaction.user.username, 
          interaction.client
        );
        
        await sendUnifiedDashboard(channel, interaction.user.id, result, "dashboard", interaction.client);
        
        await interaction.followUp({
          content: `✅ Created your command channel: ${channel}`,
          ephemeral: true
        });
      } catch (channelError) {
        console.log("Could not create command channel:", channelError.message);
      }
    }

  } catch (error) {
    if (error.message.includes("not found")) {
      // User doesn't have an instance - show registration info
      const embed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle("🎮 No Instance Found")
        .setDescription("You don't have a Foundry VTT instance yet.")
        .addFields([
          {
            name: "Demo Mode",
            value: "This is the refactored Discord bot demo. In the full version, you would register an instance here.",
            inline: false,
          },
          {
            name: "Refactored Architecture",
            value: "✅ Modular structure\n✅ Clean separation of concerns\n✅ Easy to maintain and extend",
            inline: false,
          },
          {
            name: "Next Steps",
            value: "The registration system will be implemented in the next phase of the refactoring.",
            inline: false,
          },
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {
      throw error;
    }
  }
}

module.exports = {
  handleDashboard,
};