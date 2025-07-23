function hasRequiredRole(member) {
  // Handle null member (DMs or missing member info)
  if (!member || !member.roles) return false;

  const allowedRoles = process.env.ALLOWED_ROLES?.split(",") || [];

  // Filter out empty strings and check if any real roles remain
  const validRoles = allowedRoles.filter((role) => role.trim() !== "");
  if (validRoles.length === 0) return true; // No roles required = allow everyone

  return validRoles.some((role) =>
    member.roles.cache.some(
      (memberRole) => memberRole.name.toLowerCase() === role.toLowerCase()
    )
  );
}

function hasAdminRole(member) {
  // Handle null member (DMs or missing member info)
  if (!member || !member.roles || !member.permissions) return false;

  // Check Discord's built-in Administrator permission first
  if (member.permissions.has("Administrator")) {
    return true;
  }

  // Then check custom admin roles
  const adminRoles = process.env.ADMIN_ROLES?.split(",") || ["Admin"];
  return adminRoles.some((role) =>
    member.roles.cache.some(
      (memberRole) => memberRole.name.toLowerCase() === role.toLowerCase()
    )
  );
}

module.exports = {
  hasRequiredRole,
  hasAdminRole,
};