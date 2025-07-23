const fs = require("node:fs");
const path = require("node:path");

async function loadCommands(client) {
  console.log("📚 Loading commands...");
  
  const commandsPath = path.join(__dirname, "..", "commands");
  
  // Check if commands directory exists
  if (!fs.existsSync(commandsPath)) {
    console.log("⚠️ Commands directory not found, creating...");
    fs.mkdirSync(commandsPath, { recursive: true });
    return;
  }
  
  const commandFiles = fs.readdirSync(commandsPath)
    .filter(file => file.endsWith(".js"));
  
  if (commandFiles.length === 0) {
    console.log("⚠️ No command files found");
    return;
  }
  
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if (command?.data && typeof command.execute === "function") {
      client.commands.set(command.data.name, command);
      console.log(`✅ Loaded command: ${command.data.name}`);
    } else {
      console.log(`⚠️ Invalid command file: ${file}`);
    }
  }
  
  console.log(`📚 Loaded ${client.commands.size} commands`);
}

module.exports = {
  loadCommands,
};