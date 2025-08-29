const { PermissionFlagsBits } = require("discord.js");

class GuildManager {
  constructor(config) {
    this.config = config;
  }

  // Permission checking
  hasRequiredRole(member) {
    if (!member?.roles) return false;

    const allowedRoles = this.config.getBotConfig().allowedRoles;
    if (allowedRoles.length === 0) return true; // No roles required = allow everyone

    return allowedRoles.some((role) =>
      member.roles.cache.some(
        (memberRole) => memberRole.name.toLowerCase() === role.toLowerCase()
      )
    );
  }

  hasAdminRole(member) {
    if (!member?.roles || !member?.permissions) return false;

    // Check Discord's built-in Administrator permission first
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }

    // Check custom admin roles
    const adminRoles = this.config.getBotConfig().adminRoles;
    return adminRoles.some((role) =>
      member.roles.cache.some(
        (memberRole) => memberRole.name.toLowerCase() === role.toLowerCase()
      )
    );
  }

  getUserSupporterAmount(member) {
    if (!member) return 0;

    const supporterRoles = this.config.getSupporterRoles();
    for (const [roleId, amount] of Object.entries(supporterRoles)) {
      if (member.roles.cache.has(roleId)) {
        return amount;
      }
    }
    return 0;
  }

  // Utility methods
  sanitizeUsername(username) {
    return username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 32);
  }

  getAdminRoleOverwrites(guild) {
    const adminRoles = this.config.getBotConfig().adminRoles;
    const overwrites = [];

    adminRoles.forEach((roleName) => {
      const role = guild.roles.cache.find(
        (r) => r.name.toLowerCase() === roleName.toLowerCase()
      );
      if (role) {
        overwrites.push({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        });
      }
    });

    return overwrites;
  }
}

module.exports = { GuildManager };
