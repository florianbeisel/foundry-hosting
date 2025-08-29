const { Collection } = require("discord.js");
const { logger } = require("../utils/logger");
const { ErrorHandler } = require("../utils/error-handler");

// Import command handlers
const {
  FoundryCommandHandler,
} = require("../handlers/commands/foundry-command");

// Import interaction handlers
const { ButtonHandler } = require("../handlers/interactions/button-handler");
const { ModalHandler } = require("../handlers/interactions/modal-handler");
const {
  SelectMenuHandler,
} = require("../handlers/interactions/select-menu-handler");

class InteractionHandler {
  constructor(client, lambdaService, discordService) {
    this.client = client;
    this.lambdaService = lambdaService;
    this.discordService = discordService;
    this.commands = new Collection();

    this.setupHandlers();
  }

  setupHandlers() {
    logger.info("🔧 Setting up interaction handlers...");

    // Command handlers
    const foundryCommand = new FoundryCommandHandler(
      this.lambdaService,
      this.discordService
    );
    this.commands.set("foundry", foundryCommand);

    // Interaction handlers
    this.buttonHandler = new ButtonHandler(
      this.client,
      this.lambdaService,
      this.discordService
    );

    this.modalHandler = new ModalHandler(
      this.client,
      this.lambdaService,
      this.discordService
    );

    this.selectMenuHandler = new SelectMenuHandler(
      this.client,
      this.lambdaService,
      this.discordService
    );

    logger.info("✅ Interaction handlers configured");
  }

  async handle(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await this.buttonHandler.handle(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await this.selectMenuHandler.handle(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.modalHandler.handle(interaction);
      }
    } catch (error) {
      logger.error("Interaction handler error:", error);
      await ErrorHandler.handleInteractionError(interaction, error);
    }
  }

  async handleSlashCommand(interaction) {
    // Skip role check for DMs
    if (
      interaction.guild &&
      !this.discordService.hasRequiredRole(interaction.member)
    ) {
      return await interaction.reply({
        content: "❌ You do not have permission to use Foundry commands.",
        ephemeral: true,
      });
    }

    const command = this.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error("Command execution error:", error);
      await ErrorHandler.handleInteractionError(interaction, error);
    }
  }
}

module.exports = { InteractionHandler };
