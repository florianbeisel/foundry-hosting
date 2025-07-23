const cron = require("node-cron");
const { refreshRegistrationStats, refreshAdminStatus } = require("../ui/statsService");

async function setupPeriodicTasks(client) {
  console.log("⏰ Setting up periodic tasks...");

  try {
    // Refresh statistics and admin status after startup
    await refreshRegistrationStats(client);
    console.log("✅ Refreshed registration statistics on startup");
  } catch (error) {
    console.log(
      "⚠️ Failed to refresh registration stats on startup:",
      error.message
    );
  }

  try {
    await refreshAdminStatus(client);
    console.log("✅ Refreshed admin status dashboard on startup");
  } catch (error) {
    console.log("⚠️ Failed to refresh admin status on startup:", error.message);
  }

  // Set up periodic cleanup of invalid mappings (every 6 hours)
  cron.schedule("0 */6 * * *", async () => {
    console.log("🧹 Running periodic cleanup of invalid message mappings...");
    try {
      await refreshRegistrationStats(client);
      await refreshAdminStatus(client);
      console.log("✅ Periodic cleanup completed");
    } catch (error) {
      console.error("❌ Periodic cleanup failed:", error.message);
    }
  });

  console.log("⏰ Scheduled periodic cleanup every 6 hours");
  console.log("✅ Periodic tasks setup complete");
}

module.exports = {
  setupPeriodicTasks,
};