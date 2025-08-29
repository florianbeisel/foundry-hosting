#!/usr/bin/env node
require("dotenv").config();

const { Bot } = require("./src/core/bot");
const { logger } = require("./src/utils/logger");

// Global shutdown flag
let isShuttingDown = false;

async function main() {
  try {
    logger.info("🤖 Starting Foundry VTT Discord Bot...");

    const bot = new Bot();
    await bot.initialize();
    await bot.start();

    logger.info("✅ Bot started successfully!");

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.info(`🛑 Received ${signal}, shutting down gracefully...`);

      // Set a timeout for shutdown to prevent hanging
      const shutdownTimeout = setTimeout(() => {
        logger.warn("⚠️ Shutdown timeout reached, forcing exit");
        process.exit(1);
      }, 10000); // 10 second timeout

      try {
        await bot.shutdown();
        clearTimeout(shutdownTimeout);
        logger.info("✅ Graceful shutdown completed");
        process.exit(0);
      } catch (error) {
        clearTimeout(shutdownTimeout);
        logger.error("❌ Error during graceful shutdown:", error);
        process.exit(1);
      }
    };

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  } catch (error) {
    logger.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
}

// Handle unhandled rejections and exceptions
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled promise rejection:", reason);
  logger.error("Promise:", promise);

  // During shutdown, don't exit immediately
  if (isShuttingDown) {
    logger.warn("Ignoring unhandled rejection during shutdown");
    return;
  }

  // Log the error but don't exit for unhandled rejections
  logger.warn("Continuing execution despite unhandled rejection");
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);

  // For uncaught exceptions, always exit
  logger.error("Exiting due to uncaught exception");
  process.exit(1);
});

main();
