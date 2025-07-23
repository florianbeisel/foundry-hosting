/*
 * discord/src/config/index.js
 * Centralised configuration loader for the Discord bot.
 * This module should be the ONLY place that reads from process.env.
 */

require("dotenv").config();

function required(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

module.exports = {
  discordToken: required("DISCORD_TOKEN"),
  lambdaFunctionName: required("LAMBDA_FUNCTION_NAME"),
  awsRegion: process.env.AWS_REGION || "us-east-1",
  botConfigTableName: required("BOT_CONFIG_TABLE_NAME"),
};