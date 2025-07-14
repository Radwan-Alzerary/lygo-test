// Enhanced helpers.js file for ride-hailing dispatch system
// This file contains optimized utility functions for multi-captain dispatch system

// Function to calculate the distance between two coordinates using Haversine formula
function calculateDistance(coord1, coord2) {
  // Comprehensive input validation
  if (!coord1 || !coord2 || 
      typeof coord1.latitude !== 'number' || typeof coord1.longitude !== 'number' ||
      typeof coord2.latitude !== 'number' || typeof coord2.longitude !== 'number') {
    return Infinity; // Return a large number for invalid inputs
  }

  // Check for NaN or Infinity values
  if (!isFinite(coord1.latitude) || !isFinite(coord1.longitude) ||
      !isFinite(coord2.latitude) || !isFinite(coord2.longitude)) {
    return Infinity;
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

// Enhanced function to find nearby captains using Redis geospatial commands
const findNearbyCaptains = async (redisClient, logger, origin, radius = 2) => {
  // Input validation
  if (!redisClient || !logger || !origin) {
    logger?.error('[Redis] Invalid parameters for findNearbyCaptains');
    return [];
  }

  if (!validateCoordinates(origin)) {
    logger.warn(`[Redis] Invalid origin coordinates:`, origin);
    return [];
  }

  if (typeof radius !== 'number' || radius <= 0 || radius > 100) {
    logger.warn(`[Redis] Invalid radius: ${radius}. Using default 2km`);
    radius = 2;
  }

  logger.info(`[Redis] Searching for captains near (${origin.longitude}, ${origin.latitude}) within ${radius} km.`);
  
  try {
    // Monitor performance
    redisPerformanceMonitor.startOperation('findNearbyCaptains');

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
      "COUNT", "50" // Limit results to prevent performance issues
    ];
    
    logger.debug(`[Redis] Executing GEORADIUS command: ${commandArgs.join(' ')}`);

    const nearbyCaptainsRaw = await redisClient.sendCommand(commandArgs);
    logger.debug(`[Redis] GEORADIUS raw result count: ${nearbyCaptainsRaw?.length || 0}`);

    // Transform the result and validate
    const captainIds = [];
    const invalidResults = [];

    if (Array.isArray(nearbyCaptainsRaw)) {
      for (const captainData of nearbyCaptainsRaw) {
        if (Array.isArray(captainData) && captainData.length >= 3) {
          const [captainId, distance, coordinates] = captainData;
          
          // Validate captain ID
          if (typeof captainId === 'string' && captainId.length > 0) {
            captainIds.push(captainId);
          } else {
            invalidResults.push(captainData);
          }
        } else {
          invalidResults.push(captainData);
        }
      }
    }

    if (invalidResults.length > 0) {
      logger.warn(`[Redis] Found ${invalidResults.length} invalid results in GEORADIUS response`);
    }

    logger.info(`[Redis] Found ${captainIds.length} valid captains within ${radius} km: ${captainIds.join(', ')}`);
    
    // End performance monitoring
    redisPerformanceMonitor.endOperation('findNearbyCaptains', logger);
    
    return captainIds;
  } catch (err) {
    logger.error("[Redis] Error in findNearbyCaptains:", { 
      origin, 
      radius, 
      error: err.message, 
      stack: err.stack 
    });
    
    // End performance monitoring on error
    redisPerformanceMonitor.endOperation('findNearbyCaptains', logger);
    
    // Return empty array instead of throwing to prevent cascade failures
    return [];
  }
};

// Enhanced function to find nearby captains with detailed information
const findNearbyCaptainsWithDetails = async (redisClient, logger, origin, radius = 2) => {
  if (!validateCoordinates(origin)) {
    logger?.warn(`[Redis] Invalid origin coordinates for detailed search:`, origin);
    return [];
  }

  logger.info(`[Redis] Searching for captains with details near (${origin.longitude}, ${origin.latitude}) within ${radius} km.`);
  
  try {
    redisPerformanceMonitor.startOperation('findNearbyCaptainsWithDetails');

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
      "WITHCOORD",
      "WITHDIST",
      "ASC",
      "COUNT", "50"
    ];

    const nearbyCaptainsRaw = await redisClient.sendCommand(commandArgs);
    
    // Transform to detailed objects with validation
    const captainsWithDetails = [];
    
    if (Array.isArray(nearbyCaptainsRaw)) {
      for (const captainData of nearbyCaptainsRaw) {
        try {
          if (Array.isArray(captainData) && captainData.length >= 3) {
            const [captainId, distance, coordinates] = captainData;
            
            // Validate all components
            if (typeof captainId === 'string' && 
                typeof distance === 'string' && 
                Array.isArray(coordinates) && 
                coordinates.length === 2) {
              
              const parsedDistance = parseFloat(distance);
              const longitude = parseFloat(coordinates[0]);
              const latitude = parseFloat(coordinates[1]);
              
              if (isFinite(parsedDistance) && 
                  isFinite(longitude) && 
                  isFinite(latitude) &&
                  validateCoordinates({ latitude, longitude })) {
                
                captainsWithDetails.push({
                  captainId,
                  distance: parsedDistance,
                  location: { longitude, latitude },
                  timestamp: Date.now()
                });
              }
            }
          }
        } catch (parseErr) {
          logger.warn(`[Redis] Error parsing captain data:`, { captainData, error: parseErr.message });
        }
      }
    }

    logger.info(`[Redis] Found ${captainsWithDetails.length} captains with valid details within ${radius} km`);
    redisPerformanceMonitor.endOperation('findNearbyCaptainsWithDetails', logger);
    
    return captainsWithDetails;
  } catch (err) {
    logger.error("[Redis] Error in findNearbyCaptainsWithDetails:", { 
      origin, 
      radius, 
      error: err.message 
    });
    redisPerformanceMonitor.endOperation('findNearbyCaptainsWithDetails', logger);
    return [];
  }
};

// Comprehensive coordinate validation
function validateCoordinates(coordinates) {
  if (!coordinates || typeof coordinates !== 'object') {
    return false;
  }

  const { latitude, longitude } = coordinates;

  // Check if latitude and longitude exist and are numbers
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return false;
  }

  // Check for NaN or Infinity
  if (!isFinite(latitude) || !isFinite(longitude)) {
    return false;
  }

  // Check if latitude is within valid range (-90 to 90)
  if (latitude < -90 || latitude > 90) {
    return false;
  }

  // Check if longitude is within valid range (-180 to 180)
  if (longitude < -180 || longitude > 180) {
    return false;
  }

  return true;
}

// Enhanced function to get captain location from Redis with caching
async function getCaptainLocation(redisClient, logger, captainId) {
  if (!redisClient || !logger || !captainId) {
    logger?.error('[Redis] Invalid parameters for getCaptainLocation');
    return null;
  }

  try {
    redisPerformanceMonitor.startOperation('getCaptainLocation');

    const locationData = await redisClient.geoPos("captains", captainId);
    
    if (locationData && locationData.length > 0 && locationData[0]) {
      const { longitude: lonStr, latitude: latStr } = locationData[0];
      const location = {
        latitude: parseFloat(latStr),
        longitude: parseFloat(lonStr)
      };
      
      if (validateCoordinates(location)) {
        redisPerformanceMonitor.endOperation('getCaptainLocation', logger);
        return location;
      } else {
        logger.warn(`[Redis] Invalid coordinates for captain ${captainId}:`, location);
      }
    } else {
      logger.debug(`[Redis] No location found for captain ${captainId}`);
    }
    
    redisPerformanceMonitor.endOperation('getCaptainLocation', logger);
    return null;
  } catch (err) {
    logger.error(`[Redis] Error getting location for captain ${captainId}:`, err);
    redisPerformanceMonitor.endOperation('getCaptainLocation', logger);
    return null;
  }
}

// Batch get multiple captain locations with pipeline optimization
async function getBatchCaptainLocations(redisClient, logger, captainIds) {
  if (!Array.isArray(captainIds) || captainIds.length === 0) {
    return {};
  }

  // Filter valid captain IDs
  const validCaptainIds = captainIds.filter(id => 
    typeof id === 'string' && id.length > 0
  );

  if (validCaptainIds.length === 0) {
    return {};
  }

  try {
    redisPerformanceMonitor.startOperation('getBatchCaptainLocations');

    const locations = {};
    
    // Use pipeline for better performance with multiple requests
    const pipeline = redisClient.pipeline();
    
    validCaptainIds.forEach(captainId => {
      pipeline.geopos('captains', captainId);
    });
    
    const results = await pipeline.exec();
    
    for (let i = 0; i < validCaptainIds.length; i++) {
      const captainId = validCaptainIds[i];
      const [err, locationData] = results[i];
      
      if (!err && locationData && locationData.length > 0 && locationData[0]) {
        try {
          const { longitude: lonStr, latitude: latStr } = locationData[0];
          const location = {
            latitude: parseFloat(latStr),
            longitude: parseFloat(lonStr)
          };
          
          if (validateCoordinates(location)) {
            locations[captainId] = location;
          }
        } catch (parseErr) {
          logger.warn(`[Redis] Error parsing location for captain ${captainId}:`, parseErr);
        }
      }
    }
    
    logger.debug(`[Redis] Retrieved valid locations for ${Object.keys(locations).length}/${validCaptainIds.length} captains`);
    redisPerformanceMonitor.endOperation('getBatchCaptainLocations', logger);
    
    return locations;
  } catch (err) {
    logger.error('[Redis] Error getting batch captain locations:', err);
    redisPerformanceMonitor.endOperation('getBatchCaptainLocations', logger);
    return {};
  }
}

// Format distance for human-readable display
function formatDistance(distanceKm) {
  if (typeof distanceKm !== 'number' || !isFinite(distanceKm)) {
    return 'Unknown distance';
  }

  if (distanceKm < 0) {
    return 'Invalid distance';
  }

  if (distanceKm < 0.1) {
    return `${Math.round(distanceKm * 1000)}m`;
  } else if (distanceKm < 1) {
    return `${Math.round(distanceKm * 100) / 100}km`;
  } else {
    return `${Math.round(distanceKm * 10) / 10}km`;
  }
}

// Estimate travel time based on distance and traffic conditions
function estimateTravelTime(distanceKm, averageSpeedKmh = 30, trafficMultiplier = 1) {
  if (typeof distanceKm !== 'number' || !isFinite(distanceKm) || distanceKm <= 0) {
    return 0;
  }

  if (typeof averageSpeedKmh !== 'number' || !isFinite(averageSpeedKmh) || averageSpeedKmh <= 0) {
    averageSpeedKmh = 30; // Default urban speed
  }

  if (typeof trafficMultiplier !== 'number' || !isFinite(trafficMultiplier) || trafficMultiplier <= 0) {
    trafficMultiplier = 1; // No traffic adjustment
  }

  // Calculate base time in hours, then convert to minutes
  const baseTimeHours = distanceKm / averageSpeedKmh;
  const adjustedTimeHours = baseTimeHours * trafficMultiplier;
  const timeMinutes = Math.ceil(adjustedTimeHours * 60);

  // Ensure minimum time of 1 minute
  return Math.max(1, timeMinutes);
}

// Calculate optimal search radius based on captain density
async function calculateOptimalRadius(redisClient, logger, origin, targetCaptainCount = 3, maxRadius = 10) {
  if (!validateCoordinates(origin)) {
    logger?.warn('[Radius Optimization] Invalid origin coordinates');
    return 2; // Default radius
  }

  const radiusSteps = [0.5, 1, 2, 3, 5, 7, 10, 15]; // Progressive radius steps
  const effectiveMaxRadius = Math.min(maxRadius, 15); // Cap at 15km for performance
  
  try {
    redisPerformanceMonitor.startOperation('calculateOptimalRadius');

    for (const radius of radiusSteps) {
      if (radius > effectiveMaxRadius) {
        break;
      }

      const captainIds = await findNearbyCaptains(redisClient, logger, origin, radius);
      
      if (captainIds.length >= targetCaptainCount) {
        logger.info(`[Radius Optimization] Found ${captainIds.length} captains within ${radius}km (target: ${targetCaptainCount})`);
        redisPerformanceMonitor.endOperation('calculateOptimalRadius', logger);
        return radius;
      }
    }
    
    logger.info(`[Radius Optimization] Using maximum radius ${effectiveMaxRadius}km (found fewer than ${targetCaptainCount} captains)`);
    redisPerformanceMonitor.endOperation('calculateOptimalRadius', logger);
    return effectiveMaxRadius;
  } catch (err) {
    logger.error('[Radius Optimization] Error calculating optimal radius:', err);
    redisPerformanceMonitor.endOperation('calculateOptimalRadius', logger);
    return 2; // Return safe default
  }
}

// Calculate center point of multiple coordinates
function calculateCenterPoint(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null;
  }

  // Filter out invalid coordinates
  const validCoords = coordinates.filter(coord => validateCoordinates(coord));
  
  if (validCoords.length === 0) {
    return null;
  }

  if (validCoords.length === 1) {
    return { ...validCoords[0] }; // Return copy
  }

  // Calculate average latitude and longitude
  const totalLat = validCoords.reduce((sum, coord) => sum + coord.latitude, 0);
  const totalLon = validCoords.reduce((sum, coord) => sum + coord.longitude, 0);

  return {
    latitude: totalLat / validCoords.length,
    longitude: totalLon / validCoords.length
  };
}

// Check if a point is within a circular area
function isPointInRadius(center, point, radiusKm) {
  if (!validateCoordinates(center) || !validateCoordinates(point)) {
    return false;
  }

  if (typeof radiusKm !== 'number' || radiusKm <= 0 || !isFinite(radiusKm)) {
    return false;
  }

  const distance = calculateDistance(center, point);
  return distance <= radiusKm;
}

// Calculate bearing (direction) between two points
function calculateBearing(point1, point2) {
  if (!validateCoordinates(point1) || !validateCoordinates(point2)) {
    return null;
  }

  const toRad = (deg) => deg * (Math.PI / 180);
  const toDeg = (rad) => rad * (180 / Math.PI);

  const lat1 = toRad(point1.latitude);
  const lat2 = toRad(point2.latitude);
  const deltaLon = toRad(point2.longitude - point1.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  const bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360; // Normalize to 0-360 degrees
}

// Get cardinal direction from bearing
function getCardinalDirection(bearing) {
  if (typeof bearing !== 'number' || !isFinite(bearing)) {
    return 'Unknown';
  }

  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 
                     'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
}

// Enhanced performance monitoring for Redis operations
const redisPerformanceMonitor = {
  operations: new Map(),
  
  startOperation(operationName) {
    if (!operationName || typeof operationName !== 'string') {
      return;
    }

    const existing = this.operations.get(operationName) || {
      count: 0,
      totalTime: 0,
      minTime: Infinity,
      maxTime: 0,
      avgTime: 0,
      errors: 0
    };

    this.operations.set(operationName, {
      ...existing,
      startTime: Date.now(),
      count: existing.count + 1
    });
  },
  
  endOperation(operationName, logger, isError = false) {
    const operation = this.operations.get(operationName);
    if (!operation || !operation.startTime) {
      return;
    }

    const duration = Date.now() - operation.startTime;
    
    // Update statistics
    operation.totalTime += duration;
    operation.minTime = Math.min(operation.minTime, duration);
    operation.maxTime = Math.max(operation.maxTime, duration);
    operation.avgTime = operation.totalTime / operation.count;
    
    if (isError) {
      operation.errors = (operation.errors || 0) + 1;
    }

    // Remove startTime as it's no longer needed
    delete operation.startTime;

    // Log slow operations
    if (duration > 1000) {
      logger?.warn(`[Performance] Slow Redis operation: ${operationName} took ${duration}ms`);
    }
    
    if (duration > 5000) {
      logger?.error(`[Performance] Very slow Redis operation: ${operationName} took ${duration}ms`);
    }
    
    logger?.debug(`[Performance] ${operationName}: ${duration}ms (avg: ${Math.round(operation.avgTime)}ms, count: ${operation.count})`);
  },
  
  getStats() {
    const stats = {};
    for (const [operation, data] of this.operations.entries()) {
      stats[operation] = {
        count: data.count,
        avgTime: Math.round(data.avgTime || 0),
        minTime: data.minTime === Infinity ? 0 : data.minTime,
        maxTime: data.maxTime,
        totalTime: data.totalTime || 0,
        errors: data.errors || 0,
        errorRate: data.count > 0 ? ((data.errors || 0) / data.count * 100).toFixed(2) + '%' : '0%'
      };
    }
    return stats;
  },

  reset() {
    this.operations.clear();
  }
};

// Utility function to validate and clean captain IDs
function validateCaptainIds(captainIds) {
  if (!Array.isArray(captainIds)) {
    return [];
  }

  return captainIds.filter(id => 
    typeof id === 'string' && 
    id.length > 0 && 
    id.length <= 100 && // Reasonable length limit
    /^[a-fA-F0-9]{24}$/.test(id) // MongoDB ObjectId format
  );
}

// Batch coordinate validation
function validateBatchCoordinates(coordinatesList) {
  if (!Array.isArray(coordinatesList)) {
    return [];
  }

  return coordinatesList.filter(coords => validateCoordinates(coords));
}

// Calculate area covered by a radius
function calculateRadiusArea(radiusKm) {
  if (typeof radiusKm !== 'number' || radiusKm <= 0 || !isFinite(radiusKm)) {
    return 0;
  }

  return Math.PI * radiusKm * radiusKm; // Area in square kilometers
}

// Estimate captain density in an area
function calculateCaptainDensity(captainCount, radiusKm) {
  const area = calculateRadiusArea(radiusKm);
  return area > 0 ? captainCount / area : 0; // Captains per square kilometer
}

// Helper function for coordinate transformations
function convertToGeoJSON(latitude, longitude) {
  if (!validateCoordinates({ latitude, longitude })) {
    return null;
  }

  return {
    type: "Point",
    coordinates: [longitude, latitude] // GeoJSON uses [lon, lat] order
  };
}

// Helper function to parse GeoJSON coordinates
function parseGeoJSONCoordinates(geoJSON) {
  if (!geoJSON || 
      geoJSON.type !== "Point" || 
      !Array.isArray(geoJSON.coordinates) || 
      geoJSON.coordinates.length !== 2) {
    return null;
  }

  const [longitude, latitude] = geoJSON.coordinates;
  const coords = { latitude, longitude };
  
  return validateCoordinates(coords) ? coords : null;
}

module.exports = {
  // Core functions
  calculateDistance,
  findNearbyCaptains,
  findNearbyCaptainsWithDetails,
  validateCoordinates,
  getCaptainLocation,
  getBatchCaptainLocations,
  
  // Utility functions
  formatDistance,
  estimateTravelTime,
  calculateOptimalRadius,
  calculateCenterPoint,
  isPointInRadius,
  calculateBearing,
  getCardinalDirection,
  
  // Validation and cleanup
  validateCaptainIds,
  validateBatchCoordinates,
  
  // Area and density calculations
  calculateRadiusArea,
  calculateCaptainDensity,
  
  // Coordinate transformations
  convertToGeoJSON,
  parseGeoJSONCoordinates,
  
  // Performance monitoring
  redisPerformanceMonitor
};