const { Client, GatewayIntentBits } = require("discord.js");
const { LambdaService } = require("../services/lambda-service");
const { DiscordService } = require("../services/discord-service");
const { InteractionHandler } = require("./interaction-handler");
const { ConfigManager } = require("./config-manager");
const { StateManager } = require("./state-manager");
const { GuildManager } = require("./guild-manager");
const { logger } = require("../utils/logger");
const { ErrorHandler } = require("../utils/error-handler");
const cron = require("node-cron");

class Bot {
  constructor() {
    this.client = null;
    this.config = null;
    this.stateManager = null;
    this.guildManager = null;
    this.lambdaService = null;
    this.discordService = null;
    this.interactionHandler = null;
    this.isShuttingDown = false;
    this.cronJobs = [];
  }

  async initialize() {
    logger.info("🔧 Initializing bot components...");

    // Initialize configuration
    this.config = new ConfigManager();
    await this.config.validate();

    // Initialize state management
    this.stateManager = new StateManager(this.config);
    await this.stateManager.initialize();

    // Initialize guild management
    this.guildManager = new GuildManager(this.config);

    // Initialize Discord client
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Initialize services
    this.lambdaService = new LambdaService();
    this.discordService = new DiscordService(this.client);
    this.discordService.setDependencies(
      this.stateManager,
      this.config,
      this.guildManager
    );

    // Initialize interaction handler
    this.interactionHandler = new InteractionHandler(
      this.client,
      this.lambdaService,
      this.discordService
    );

    // Set up event listeners
    this.setupEventListeners();

    logger.info("✅ Bot components initialized");
  }

  setupEventListeners() {
    // Bot ready event
    this.client.once("ready", async () => {
      logger.info(`✅ Bot ready! Logged in as ${this.client.user.tag}`);
      logger.info(`📋 Registered in ${this.client.guilds.cache.size} servers`);

      this.client.user.setActivity("Foundry VTT instances", {
        type: "WATCHING",
      });

      try {
        await this.discordService.setupLoggingChannel();
        await this.discordService.syncAllInstances(this.lambdaService);
        await this.setupCronJobs();
        logger.info("🎉 Bot startup complete!");
      } catch (error) {
        logger.error("❌ Error during bot startup:", error);
      }
    });

    // Error handling
    this.client.on("error", (error) => {
      logger.error("Discord client error:", error);
      ErrorHandler.handle(error);
    });

    // Interaction handling
    this.client.on("interactionCreate", async (interaction) => {
      try {
        await this.interactionHandler.handle(interaction);
      } catch (error) {
        logger.error("Interaction handling error:", error);
        ErrorHandler.handle(error);
      }
    });
  }

  async setupCronJobs() {
    logger.info("⏰ Setting up cron jobs...");

    // Refresh registration stats every 5 minutes
    const statsJob = cron.schedule(
      "*/5 * * * *",
      async () => {
        try {
          await this.discordService.refreshRegistrationStats(
            this.lambdaService
          );
        } catch (error) {
          logger.error("Stats refresh cron error:", error);
        }
      },
      { scheduled: false }
    );

    // Refresh command channels every 3 minutes
    const channelsJob = cron.schedule(
      "*/3 * * * *",
      async () => {
        try {
          await this.discordService.refreshCommandChannels(this.lambdaService);
        } catch (error) {
          logger.error("Channels refresh cron error:", error);
        }
      },
      { scheduled: false }
    );

    // Clean up old cache entries every hour
    const cleanupJob = cron.schedule(
      "0 * * * *",
      async () => {
        try {
          await this.discordService.cleanupOldCache(this.lambdaService);
        } catch (error) {
          logger.error("Cache cleanup cron error:", error);
        }
      },
      { scheduled: false }
    );

    // Check for notifications every 2 minutes
    const notificationsJob = cron.schedule(
      "*/2 * * * *",
      async () => {
        try {
          await this.discordService.checkNotifications(this.lambdaService);
        } catch (error) {
          logger.error("Notifications cron error:", error);
        }
      },
      { scheduled: false }
    );

    // Periodic mapping cleanup every 6 hours
    const mappingCleanupJob = cron.schedule(
      "0 */6 * * *",
      async () => {
        try {
          await this.discordService.cleanupInvalidMappings();
        } catch (error) {
          logger.error("Mapping cleanup cron error:", error);
        }
      },
      { scheduled: false }
    );

    // Store cron jobs for cleanup
    this.cronJobs = [
      statsJob,
      channelsJob,
      cleanupJob,
      notificationsJob,
      mappingCleanupJob,
    ];

    // Start all cron jobs
    this.cronJobs.forEach((job) => job.start());

    logger.info(`✅ Started ${this.cronJobs.length} cron jobs`);
  }

  async start() {
    if (!this.client) {
      throw new Error("Bot not initialized. Call initialize() first.");
    }

    logger.info("🔐 Logging in to Discord...");
    await this.client.login(process.env.DISCORD_TOKEN);
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info("🛑 Shutting down bot...");

    try {
      // Stop cron jobs first
      logger.info("🛑 Stopping cron jobs...");
      this.cronJobs.forEach((job) => {
        if (job && typeof job.destroy === "function") {
          try {
            job.destroy();
          } catch (error) {
            logger.warn("Failed to destroy cron job:", error.message);
          }
        }
      });
      this.cronJobs = [];

      // Cleanup services with proper error handling
      if (this.discordService) {
        logger.info("🛑 Cleaning up Discord service...");
        try {
          await this.discordService.cleanup();
        } catch (error) {
          logger.error("Error during Discord service cleanup:", error.message);
        }
      }

      if (this.stateManager) {
        logger.info("🛑 Cleaning up state manager...");
        try {
          this.stateManager.cleanup();
        } catch (error) {
          logger.error("Error during state manager cleanup:", error.message);
        }
      }

      // Destroy Discord client last
      if (this.client) {
        logger.info("🛑 Destroying Discord client...");
        try {
          this.client.destroy();
        } catch (error) {
          logger.error("Error destroying Discord client:", error.message);
        }
      }

      logger.info("✅ Bot shutdown complete");
    } catch (error) {
      logger.error("❌ Error during shutdown:", error.message);
      // Force exit if shutdown fails
      process.exit(1);
    }
  }
}

module.exports = { Bot };
