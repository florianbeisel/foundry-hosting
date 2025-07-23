const { MessageFlags } = require("discord.js");

async function handleTestLog(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const testMessage = interaction.options.getString("message");

    // Send test message to console (which will be captured by our logging system)
    console.log(`🧪 Test log message: ${testMessage}`);
    console.warn(`🧪 Test warning message: ${testMessage}`);
    console.error(`🧪 Test error message: ${testMessage}`);

    await interaction.editReply({
      content: `✅ Test log messages sent! Check the #foundry-bot-logs channel to see them.`,
    });
  } catch (error) {
    console.error("Test log error:", error);
    await interaction.editReply({
      content: `❌ Error sending test log: ${error.message}`,
    });
  }
}

module.exports = {
  handleTestLog,
};