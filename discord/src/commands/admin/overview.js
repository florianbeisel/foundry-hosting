const { EmbedBuilder, MessageFlags } = require("discord.js");

async function handleAdminOverview(interaction) {
  await interaction.reply({
    content: "🚧 Admin overview not yet implemented in refactored version",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  handleAdminOverview,
};