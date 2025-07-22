// Function to calculate the distance between two coordinates
function calculateDistance(coord1, coord2) {
  // Basic check for valid inputs
  if (!coord1 || !coord2 || typeof coord1.latitude !== 'number' || typeof coord1.longitude !== 'number' ||
    typeof coord2.latitude !== 'number' || typeof coord2.longitude !== 'number') {
    return Infinity; // Return a large number or handle error appropriately
  }

  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const dLat = toRad(coord2.latitude - coord1.latitude);
  const dLon = toRad(coord2.longitude - coord1.longitude);

  const lat1 = toRad(coord1.latitude);
  const lat2 = toRad(coord2.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2) *
    Math.cos(lat1) *
    Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c; // Distance in km
  return distance;
}

// Function to find nearby captains using Redis geospatial commands
const findNearbyCaptains = async (redisClient, logger, origin, radius = 2) => {
  logger.info(`[Redis] Searching for captains near (${origin.longitude}, ${origin.latitude}) within ${radius} km.`);
  try {
    // Ensure coordinates are strings for Redis command
    const lonStr = String(origin.longitude);
    const latStr = String(origin.latitude);
    const radiusStr = String(radius);

    const commandArgs = [
      "GEORADIUS",
      "captains",
      lonStr,
      latStr,
      radiusStr,
      "km",
      "WITHCOORD", // Include coordinates in the reply
      "WITHDIST",  // Include distance in the reply
      "ASC",       // Sort by distance ascending
    ];
    logger.debug(`[Redis] Executing GEORADIUS command: ${commandArgs.join(' ')}`);

    const nearbyCaptainsRaw = await redisClient.sendCommand(commandArgs);
    logger.debug(`[Redis] GEORADIUS raw result: ${JSON.stringify(nearbyCaptainsRaw)}`);

    // Transform the result: [ ["captainId1", "distance1", ["lon1", "lat1"]], ["captainId2", ...] ]
    // We only need the captain IDs for this function's current usage.
    const captainIds = nearbyCaptainsRaw.map((captainData) => captainData[0]); // captainData is like ["captainId", "distance", ["lon", "lat"]]
    logger.info(`[Redis] Found ${captainIds.length} captains within ${radius} km: ${captainIds.join(', ')}`);
    return captainIds;
  } catch (err) {
    logger.error("[Redis] Error in findNearbyCaptains:", { origin, radius, error: err.message, stack: err.stack });
    throw err; // Re-throw to be handled by caller
  }
};

module.exports = {
  calculateDistance,
  findNearbyCaptains
};