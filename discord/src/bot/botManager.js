const { Collection } = require("discord.js");
const { loadCommands } = require("./commandLoader");
const { handleInteraction } = require("./interactionHandler");

async function initializeBot(client) {
  console.log("🔧 Initializing bot components...");
  
  // Initialize client properties
  client.commands = new Collection();
  client.userChannels = new Map(); // userId -> channelId
  client.statusMonitors = new Map(); // userId -> interval
  client.registrationStats = new Map(); // channelId -> statsMessageId
  client.adminStatusMapping = new Map(); // channelId -> adminStatusMessageId
  client.userStatusMessages = new Map(); // userId -> messageId
  client.userDashboardMessages = new Map(); // userId -> dashboard messageId
  client.lastKnownStatus = new Map(); // userId -> { status, updatedAt, url }
  
  // Load all commands
  await loadCommands(client);
  
  // Setup interaction handling
  client.on("interactionCreate", async (interaction) => {
    await handleInteraction(interaction, client);
  });
  
  console.log("✅ Bot components initialized");
}

module.exports = {
  initializeBot,
};