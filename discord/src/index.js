require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const { initializeBot } = require("./bot/botManager");
const { setupLogging } = require("./utils/logging");
const { syncAllInstances } = require("./services/instanceSync");
const { setupPeriodicTasks } = require("./services/periodicTasks");
const { loadConfigFromDatabase } = require("./services/configService");

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function main() {
  try {
    console.log("🚀 Starting Foundry VTT Discord Bot...");
    
    // Initialize bot components
    await initializeBot(client);
    
    // Setup logging system
    await setupLogging(client);
    
    // Load configuration from database
    await loadConfigFromDatabase(client);
    
    // Login to Discord
    await client.login(process.env.DISCORD_TOKEN);
    
    console.log("✅ Bot initialization complete!");
    
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
}

// Bot ready event
client.once("ready", async () => {
  console.log(`✅ Foundry VTT Bot is ready! Logged in as ${client.user.tag}`);
  console.log(`📋 Registered in ${client.guilds.cache.size} servers`);

  client.user.setActivity("Foundry VTT instances", { type: "WATCHING" });

  try {
    // Sync all running instances
    await syncAllInstances(client);
    
    // Setup periodic tasks (cleanup, stats refresh, etc.)
    await setupPeriodicTasks(client);
    
    console.log("🎮 All systems operational!");
    
  } catch (error) {
    console.error("❌ Post-startup setup failed:", error);
  }
});

// Error handling
client.on("error", (error) => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

// Start the application
main();