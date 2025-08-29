const { logger } = require("../utils/logger");

class ConfigManager {
  constructor() {
    this.config = {
      discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.DISCORD_CLIENT_ID,
        guildId: process.env.DISCORD_GUILD_ID,
      },
      aws: {
        region: process.env.AWS_REGION || "us-east-1",
        lambdaFunctionName: process.env.LAMBDA_FUNCTION_NAME,
        botConfigTableName: process.env.BOT_CONFIG_TABLE_NAME,
      },
      bot: {
        foundryCategory: process.env.FOUNDRY_CATEGORY_ID,
        allowedRoles:
          process.env.ALLOWED_ROLES?.split(",").filter((r) => r.trim()) || [],
        adminRoles: process.env.ADMIN_ROLES?.split(",").filter((r) =>
          r.trim()
        ) || ["Admin"],
        kofiUrl: process.env.KOFI_URL,
        instanceCostPerHour: parseFloat(
          process.env.INSTANCE_COST_PER_HOUR || "0.10"
        ),
      },
      supporterRoles: {
        "699727231794020353": 15, // $15 supporter
        "699727011979067484": 10, // $10 supporter
        "699727432424620033": 5, // $5 supporter
      },
    };
  }

  async validate() {
    logger.info("🔍 Validating configuration...");

    const required = [
      { key: "DISCORD_TOKEN", value: this.config.discord.token },
      { key: "DISCORD_CLIENT_ID", value: this.config.discord.clientId },
      {
        key: "LAMBDA_FUNCTION_NAME",
        value: this.config.aws.lambdaFunctionName,
      },
    ];

    const missing = required.filter(({ value }) => !value);

    if (missing.length > 0) {
      const missingKeys = missing.map(({ key }) => key).join(", ");
      throw new Error(`Missing required environment variables: ${missingKeys}`);
    }

    logger.info("✅ Configuration validated");
  }

  get(path) {
    return path.split(".").reduce((obj, key) => obj?.[key], this.config);
  }

  getDiscordConfig() {
    return this.config.discord;
  }

  getAWSConfig() {
    return this.config.aws;
  }

  getBotConfig() {
    return this.config.bot;
  }

  getSupporterRoles() {
    return this.config.supporterRoles;
  }
}

module.exports = { ConfigManager };
