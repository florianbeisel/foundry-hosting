const { hasRequiredRole, hasAdminRole } = require("../utils/permissions");
const { invokeLambda } = require("../services/lambdaService");
const { sendUnifiedDashboard } = require("../ui/dashboardService");
const { createUserCommandChannel } = require("../utils/channelUtils");

async function handleSlashCommand(interaction, client) {
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
    // Add helper methods to interaction
    interaction.invokeLambda = invokeLambda;
    interaction.sendUnifiedDashboard = sendUnifiedDashboard;
    interaction.hasAdminRole = () =>
      interaction.guild ? hasAdminRole(interaction.member) : false;
    interaction.createUserCommandChannel = (userId, username) =>
      createUserCommandChannel(interaction.guild, userId, username, client);
    
    // Add client reference for handlers that need it
    interaction.client = client;

    await command.execute(interaction);
  } catch (error) {
    console.error("Command execution error:", error);
    throw error; // Let the main handler deal with error responses
  }
}

module.exports = {
  handleSlashCommand,
};