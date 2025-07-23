const { MessageFlags } = require("discord.js");

async function handleCleanupMappings(interaction) {
  await interaction.reply({
    content: "🚧 Cleanup mappings not yet implemented in refactored version",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  handleCleanupMappings,
};