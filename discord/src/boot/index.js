/*
 * discord/src/boot/index.js
 * Minimal entrypoint that wires environment config and starts the bot.
 * For now we simply load the existing monolithic implementation so that
 * behaviour remains unchanged. As we migrate to modular code we will
 * replace the legacy require with new modular components.
 */

// Ensure config can throw early if required env vars are missing
const config = require("../config");

// The legacy monolith (to be refactored incrementally)
require("../../index.js");