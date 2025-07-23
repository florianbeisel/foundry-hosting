const { EmbedBuilder, MessageFlags } = require("discord.js");

async function handleHelp(interaction) {
  const embed = new EmbedBuilder()
    .setColor("#0099ff")
    .setTitle("Foundry VTT Bot Help")
    .setDescription("Manage Foundry VTT instances directly from Discord.")
    .addFields([
      {
        name: "Getting Started",
        value:
          "• `/foundry user dashboard` – view status or register an instance\n" +
          "• Use the provided buttons to start or stop your instance\n" +
          "• Follow updates in your personal command channel",
      },
      {
        name: "Commands",
        value:
          "`/foundry user dashboard` – personal control panel\n" +
          "`/foundry user help` – this help message\n" +
          "`/foundry user license-sharing` – manage license sharing\n" +
          "`/foundry admin overview` – system-wide status (admin)\n" +
          "`/foundry admin setup-registration` – post registration embed (admin)",
      },
    ])
    .setFooter({ text: "Need more information? Contact an administrator." })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  handleHelp,
};