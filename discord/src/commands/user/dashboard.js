const { EmbedBuilder, MessageFlags } = require("discord.js");

async function handleDashboard(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Check if user has an instance
    const result = await interaction.invokeLambda({
      action: "status",
      userId: interaction.user.id,
    });

    // For now, just show a basic status message
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setTitle("🎲 Your Foundry VTT Dashboard")
      .setDescription(`Instance Status: **${result.status}**`)
      .addFields([
        { name: "User ID", value: interaction.user.id, inline: true },
        { name: "Username", value: interaction.user.username, inline: true },
      ])
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    if (error.message.includes("not found")) {
      // User doesn't have an instance - show registration info
      const embed = new EmbedBuilder()
        .setColor("#ff9900")
        .setTitle("🎮 No Instance Found")
        .setDescription("You don't have a Foundry VTT instance yet.")
        .addFields([
          {
            name: "Next Steps",
            value: "Use the registration system to create your instance.",
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