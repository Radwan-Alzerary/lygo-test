/**
 * Enterprise-Grade Fare Calculation Helper
 * Centralized fare calculation with comprehensive pricing logic
 *
 * @version 2.1.0
 * @author Senior Backend Team
 */

// ===========================================================================================
// DISTANCE CALCULATION
// ===========================================================================================

/**
 * Calculates the distance between two geographical coordinates using the Haversine formula.
 * @param {Array<number>} coords1 - The first coordinates as [longitude, latitude].
 * @param {Array<number>} coords2 - The second coordinates as [longitude, latitude].
 * @returns {number} The distance in kilometers.
 */
function calculateDistance(coords1, coords2) {
    const R = 6371; // Radius of the Earth in kilometers
    const lon1 = coords1[0];
    const lat1 = coords1[1];
    const lon2 = coords2[0];
    const lat2 = coords2[1];

    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
}
function estimateDuration(distanceKm) {
    const averageSpeedKmh = 30; // km per hour
    const durationHours = distanceKm / averageSpeedKmh;
    return Math.round(durationHours * 60);
}

function roundToNearest(amount, nearest) {
    return Math.ceil(amount / nearest) * nearest;
}

// ===========================================================================================
// MAIN FARE CALCULATION LOGIC
// ===========================================================================================

/**
 * Calculate comprehensive ride fare with detailed breakdown
 * @param {Object} rideDetails - Ride information
 * @param {Object} settings - Pricing settings from database
 * @param {Object} options - Additional calculation options
 * @returns {Object} Detailed fare breakdown
 */
function calculateRideFare(rideDetails, settings, options = {}) {
    try {
        // Validate inputs
        const validation = validateCalculationInputs(rideDetails, settings);
        if (!validation.isValid) {
            throw new Error(`Fare calculation validation failed: ${validation.error}`);
        }

        // Initialize calculation context
        const context = initializeCalculationContext(rideDetails, settings, options);

        // Perform comprehensive fare calculation
        const fareBreakdown = {
            // Base components
            baseFare: calculateBaseFare(context),
            distanceFare: calculateDistanceFare(context),
            timeFare: calculateTimeFare(context),

            // Dynamic pricing
            surgePricing: calculateSurgePricing(context),
            demandMultiplier: calculateDemandMultiplier(context),

            // Time-based adjustments
            timeMultipliers: calculateTimeMultipliers(context),

            // Special adjustments
            serviceFee: calculateServiceFee(context),
            taxes: calculateTaxes(context),
            discounts: calculateDiscounts(context),
            promotions: calculatePromotions(context),

            // Additional fees
            bookingFee: calculateBookingFee(context),
            cancellationFee: calculateCancellationFee(context),
            tolls: calculateTolls(context),
            airportFee: calculateAirportFee(context),

            // Metadata
            calculationMetadata: generateCalculationMetadata(context)
        };

        // Calculate subtotals and final amounts
        const totals = calculateTotals(fareBreakdown, context);

        // Apply fare limits and validations
        const finalFare = applyFareLimits(totals, context);

        // Generate detailed response
        return generateDetailedFareResponse(fareBreakdown, finalFare, context);

    } catch (error) {
        console.error('[FareCalculation] Error calculating fare:', error);
        return generateErrorResponse(error, rideDetails, settings);
    }
}

/**
 * Validate calculation inputs
 */
function validateCalculationInputs(rideDetails, settings) {
    const errors = [];

    // Validate ride details
    if (!rideDetails) {
        errors.push('Ride details are required');
    } else {
        if (typeof rideDetails.distance !== 'number' || rideDetails.distance < 0) {
            errors.push('Valid distance is required');
        }
        if (rideDetails.duration !== undefined && (typeof rideDetails.duration !== 'number' || rideDetails.duration < 0)) {
            errors.push('Duration must be a positive number');
        }
        if (rideDetails.pickupLocation && (!rideDetails.pickupLocation.coordinates || rideDetails.pickupLocation.coordinates.length !== 2)) {
            errors.push('Valid pickup location coordinates required');
        }
        if (rideDetails.dropoffLocation && (!rideDetails.dropoffLocation.coordinates || rideDetails.dropoffLocation.coordinates.length !== 2)) {
            errors.push('Valid dropoff location coordinates required');
        }
    }

    // Validate settings
    if (!settings || !settings.fare) {
        errors.push('Fare settings are required');
    } else {
        const fare = settings.fare;
        if (typeof fare.baseFare !== 'number' || fare.baseFare < 0) {
            errors.push('Valid base fare is required');
        }
        if (typeof fare.pricePerKm !== 'number' || fare.pricePerKm < 0) {
            errors.push('Valid price per km is required');
        }
        if (typeof fare.minRidePrice !== 'number' || fare.minRidePrice < 0) {
            errors.push('Valid minimum ride price is required');
        }
        if (typeof fare.maxRidePrice !== 'number' || fare.maxRidePrice <= fare.minRidePrice) {
            errors.push('Valid maximum ride price is required');
        }
    }

    return {
        isValid: errors.length === 0,
        error: errors.join(', ')
    };
}

/**
 * Initialize calculation context with all necessary data
 */
function initializeCalculationContext(rideDetails, settings, options) {
    const now = new Date();

    return {
        // Ride information
        ride: {
            distance: rideDetails.distance,
            duration: rideDetails.duration || estimateDuration(rideDetails.distance),
            pickupLocation: rideDetails.pickupLocation,
            dropoffLocation: rideDetails.dropoffLocation,
            vehicleType: rideDetails.vehicleType || 'standard',
            paymentMethod: rideDetails.paymentMethod || 'cash',
            isShared: rideDetails.isShared || false,
            priority: rideDetails.priority || 'normal',
            scheduledTime: rideDetails.scheduledTime,
            customerType: rideDetails.customerType || 'regular'
        },

        // Settings
        settings: {
            ...settings,
            // Ensure defaults for missing values
            fare: {
                baseFare: 3000,
                pricePerKm: 500,
                pricePerMinute: 0,
                minRidePrice: 2000,
                maxRidePrice: 50000,
                nightMultiplier: 1.2,
                weekendMultiplier: 1.15,
                currency: 'IQD',
                ...settings.fare
            }
        },

        // Time context
        time: {
            current: now,
            hour: now.getHours(),
            day: now.getDay(), // 0 = Sunday, 6 = Saturday
            isWeekend: now.getDay() === 0 || now.getDay() === 6,
            isNight: now.getHours() >= 22 || now.getHours() < 6,
            isPeakHour: isPeakHour(now),
            isHoliday: isHoliday(now)
        },

        // Market conditions
        market: {
            demandLevel: options.demandLevel || getDemandLevel(rideDetails, now),
            surgeActive: options.surgeActive || false,
            surgeMultiplier: options.surgeMultiplier || 1.0,
            cityZone: getCityZone(rideDetails.pickupLocation),
            weatherCondition: options.weatherCondition || 'normal'
        },

        // Calculation options
        options: {
            includeServiceFee: options.includeServiceFee !== false,
            includeTaxes: options.includeTaxes !== false,
            applyPromotions: options.applyPromotions !== false,
            customerId: options.customerId,
            captainId: options.captainId,
            estimateOnly: options.estimateOnly || false,
            breakdown: options.breakdown !== false
        }
    };
}

/**
 * Calculate base fare
 */
function calculateBaseFare(context) {
    let baseFare = context.settings.fare.baseFare;

    // Vehicle type multiplier
    const vehicleMultipliers = {
        'economy': 1.0,
        'standard': 1.0,
        'comfort': 1.3,
        'premium': 1.8,
        'luxury': 2.5,
        'suv': 1.4,
        'van': 1.6
    };

    const vehicleMultiplier = vehicleMultipliers[context.ride.vehicleType] || 1.0;
    baseFare *= vehicleMultiplier;

    return {
        amount: Math.round(baseFare),
        vehicleType: context.ride.vehicleType,
        vehicleMultiplier: vehicleMultiplier,
        originalAmount: context.settings.fare.baseFare
    };
}

/**
 * Calculate distance-based fare
 */
function calculateDistanceFare(context) {
    const distance = context.ride.distance;
    const pricePerKm = context.settings.fare.pricePerKm;

    // Tiered pricing for long distances
    let distanceFare = 0;
    let remainingDistance = distance;

    const tiers = [
        { limit: 5, rate: 1.0 },    // First 5km at full rate
        { limit: 10, rate: 0.9 },   // Next 5km at 90%
        { limit: 20, rate: 0.8 },   // Next 10km at 80%
        { limit: Infinity, rate: 0.7 } // Beyond 20km at 70%
    ];

    const breakdown = [];
    let distanceCovered = 0;

    for (const tier of tiers) {
        if (remainingDistance <= 0) break;

        const distanceInTier = Math.min(remainingDistance, tier.limit - distanceCovered);
        if (distanceInTier <= 0) continue;

        const tierRate = pricePerKm * tier.rate;
        const tierCost = distanceInTier * tierRate;

        distanceFare += tierCost;
        breakdown.push({
            distance: distanceInTier,
            rate: tierRate,
            cost: Math.round(tierCost),
            multiplier: tier.rate
        });

        remainingDistance -= distanceInTier;
        distanceCovered += distanceInTier;
    }


    // Shared ride discount
    if (context.ride.isShared) {
        distanceFare *= 0.75; // 25% discount for shared rides
    }

    return {
        amount: Math.round(distanceFare),
        totalDistance: distance,
        pricePerKm: pricePerKm,
        breakdown: breakdown,
        isShared: context.ride.isShared,
        sharedDiscount: context.ride.isShared ? 0.25 : 0
    };
}

/**
 * Calculate time-based fare
 */
function calculateTimeFare(context) {
    const duration = context.ride.duration;
    const pricePerMinute = context.settings.fare.pricePerMinute || 0;

    if (pricePerMinute === 0) {
        return {
            amount: 0,
            duration: duration,
            pricePerMinute: 0,
            included: false
        };
    }

    // Minimum billable time (e.g., 2 minutes)
    const minBillableTime = 2;
    const billableTime = Math.max(duration, minBillableTime);

    // Time-based pricing with waiting time consideration
    let timeFare = billableTime * pricePerMinute;

    // Additional waiting time charges (after first 3 minutes)
    const freeWaitingTime = 3;
    if (duration > freeWaitingTime) {
        const waitingTime = duration - freeWaitingTime;
        const waitingRate = pricePerMinute * 1.5; // 50% higher rate for waiting
        timeFare += waitingTime * waitingRate;
    }

    return {
        amount: Math.round(timeFare),
        duration: duration,
        billableTime: billableTime,
        pricePerMinute: pricePerMinute,
        waitingTime: Math.max(0, duration - freeWaitingTime),
        waitingRate: pricePerMinute * 1.5,
        included: true
    };
}

/**
 * Calculate surge pricing
 */
function calculateSurgePricing(context) {
    if (!context.market.surgeActive) {
        return {
            amount: 0,
            active: false,
            multiplier: 1.0,
            reason: 'no_surge'
        };
    }

    const surgeMultiplier = context.market.surgeMultiplier;
    const baseFareAmount = context.settings.fare.baseFare;
    const surgeAmount = baseFareAmount * (surgeMultiplier - 1);

    return {
        amount: Math.round(surgeAmount),
        active: true,
        multiplier: surgeMultiplier,
        reason: getSurgeReason(context),
        level: getSurgeLevel(surgeMultiplier)
    };
}

/**
 * Calculate demand-based multiplier
 */
function calculateDemandMultiplier(context) {
    const demandLevel = context.market.demandLevel;

    const demandMultipliers = {
        'very_low': 0.9,
        'low': 0.95,
        'normal': 1.0,
        'high': 1.1,
        'very_high': 1.2,
        'extreme': 1.3
    };

    const multiplier = demandMultipliers[demandLevel] || 1.0;

    if (multiplier === 1.0) {
        return {
            amount: 0,
            level: demandLevel,
            multiplier: multiplier,
            applied: false
        };
    }

    const baseFareAmount = context.settings.fare.baseFare;
    const demandAmount = baseFareAmount * (multiplier - 1);

    return {
        amount: Math.round(demandAmount),
        level: demandLevel,
        multiplier: multiplier,
        applied: true
    };
}

/**
 * Calculate time-based multipliers (night, weekend, holiday)
 */
function calculateTimeMultipliers(context) {
    const multipliers = {
        night: {
            active: context.time.isNight,
            multiplier: context.settings.fare.nightMultiplier || 1.2,
            amount: 0
        },
        weekend: {
            active: context.time.isWeekend,
            multiplier: context.settings.fare.weekendMultiplier || 1.15,
            amount: 0
        },
        holiday: {
            active: context.time.isHoliday,
            multiplier: context.settings.fare.holidayMultiplier || 1.25,
            amount: 0
        },
        peakHour: {
            active: context.time.isPeakHour,
            multiplier: context.settings.fare.peakHourMultiplier || 1.1,
            amount: 0
        }
    };

    // Calculate combined multiplier (not additive, but multiplicative)
    let combinedMultiplier = 1.0;
    let activeMultipliers = [];

    Object.keys(multipliers).forEach(key => {
        const mult = multipliers[key];
        if (mult.active && mult.multiplier > 1.0) {
            combinedMultiplier *= mult.multiplier;
            activeMultipliers.push(key);
        }
    });

    // Apply to base fare if any multipliers are active
    if (combinedMultiplier > 1.0) {
        const baseFareAmount = context.settings.fare.baseFare;
        const totalMultiplierAmount = baseFareAmount * (combinedMultiplier - 1);

        // Distribute the amount proportionally among active multipliers
        activeMultipliers.forEach(key => {
            const mult = multipliers[key];
            const proportion = (mult.multiplier - 1) / (combinedMultiplier - 1);
            mult.amount = Math.round(totalMultiplierAmount * proportion);
        });
    }

    return {
        ...multipliers,
        combined: {
            multiplier: combinedMultiplier,
            totalAmount: Math.round(context.settings.fare.baseFare * (combinedMultiplier - 1)),
            activeMultipliers: activeMultipliers
        }
    };
}

/**
 * Calculate service fee
 */
function calculateServiceFee(context) {
    if (!context.options.includeServiceFee) {
        return {
            amount: 0,
            included: false,
            reason: 'excluded_by_option'
        };
    }

    const serviceFeeConfig = context.settings.serviceFee || {
        type: 'percentage',
        value: 0.05, // 5%
        minimum: 100,
        maximum: 1000
    };

    let serviceFeeAmount = 0;

    if (serviceFeeConfig.type === 'percentage') {
        const baseFare = context.settings.fare.baseFare;
        serviceFeeAmount = baseFare * serviceFeeConfig.value;
    } else if (serviceFeeConfig.type === 'fixed') {
        serviceFeeAmount = serviceFeeConfig.value;
    }

    // Apply min/max limits
    if (serviceFeeConfig.minimum) {
        serviceFeeAmount = Math.max(serviceFeeAmount, serviceFeeConfig.minimum);
    }
    if (serviceFeeConfig.maximum) {
        serviceFeeAmount = Math.min(serviceFeeAmount, serviceFeeConfig.maximum);
    }

    return {
        amount: Math.round(serviceFeeAmount),
        type: serviceFeeConfig.type,
        rate: serviceFeeConfig.value,
        minimum: serviceFeeConfig.minimum,
        maximum: serviceFeeConfig.maximum,
        included: true
    };
}

/**
 * Calculate taxes
 */
function calculateTaxes(context) {
    if (!context.options.includeTaxes) {
        return {
            amount: 0,
            included: false,
            breakdown: []
        };
    }

    const taxConfig = context.settings.taxes || [
        { name: 'VAT', rate: 0.0, type: 'percentage' }, // Iraq typically doesn't have VAT on transportation
        { name: 'Municipal Tax', rate: 50, type: 'fixed' }
    ];

    const baseFare = context.settings.fare.baseFare;
    let totalTax = 0;
    const breakdown = [];

    taxConfig.forEach(tax => {
        let taxAmount = 0;

        if (tax.type === 'percentage') {
            taxAmount = baseFare * tax.rate;
        } else if (tax.type === 'fixed') {
            taxAmount = tax.rate;
        }

        totalTax += taxAmount;
        breakdown.push({
            name: tax.name,
            type: tax.type,
            rate: tax.rate,
            amount: Math.round(taxAmount)
        });
    });

    return {
        amount: Math.round(totalTax),
        included: true,
        breakdown: breakdown
    };
}

/**
 * Calculate discounts
 */
function calculateDiscounts(context) {
    const discounts = [];
    let totalDiscount = 0;

    // Customer type discounts
    if (context.ride.customerType === 'premium') {
        const premiumDiscount = context.settings.fare.baseFare * 0.1; // 10% for premium customers
        discounts.push({
            type: 'customer_type',
            name: 'Premium Customer Discount',
            amount: Math.round(premiumDiscount),
            percentage: 10
        });
        totalDiscount += premiumDiscount;
    }

    // First ride discount
    if (context.options.isFirstRide) {
        const firstRideDiscount = Math.min(context.settings.fare.baseFare * 0.2, 1000); // 20% up to 1000
        discounts.push({
            type: 'first_ride',
            name: 'First Ride Discount',
            amount: Math.round(firstRideDiscount),
            percentage: 20,
            maximum: 1000
        });
        totalDiscount += firstRideDiscount;
    }

    // Loyalty discount
    if (context.options.loyaltyLevel) {
        const loyaltyRates = {
            'bronze': 0.05,
            'silver': 0.08,
            'gold': 0.12,
            'platinum': 0.15
        };
        const loyaltyRate = loyaltyRates[context.options.loyaltyLevel];
        if (loyaltyRate) {
            const loyaltyDiscount = context.settings.fare.baseFare * loyaltyRate;
            discounts.push({
                type: 'loyalty',
                name: `${context.options.loyaltyLevel.toUpperCase()} Loyalty Discount`,
                amount: Math.round(loyaltyDiscount),
                percentage: loyaltyRate * 100,
                level: context.options.loyaltyLevel
            });
            totalDiscount += loyaltyDiscount;
        }
    }

    return {
        amount: Math.round(totalDiscount),
        count: discounts.length,
        breakdown: discounts,
        applied: discounts.length > 0
    };
}

/**
 * Calculate promotions
 */
function calculatePromotions(context) {
    if (!context.options.applyPromotions) {
        return {
            amount: 0,
            applied: false,
            reason: 'excluded_by_option'
        };
    }

    // This would typically check against active promotions in database
    const activePromotions = context.options.activePromotions || [];

    let totalPromotion = 0;
    const appliedPromotions = [];

    activePromotions.forEach(promo => {
        let promoAmount = 0;
        let isApplicable = false;

        // Check promotion conditions
        if (promo.type === 'percentage' && checkPromotionConditions(promo, context)) {
            promoAmount = context.settings.fare.baseFare * (promo.discount / 100);
            isApplicable = true;
        } else if (promo.type === 'fixed' && checkPromotionConditions(promo, context)) {
            promoAmount = promo.discount;
            isApplicable = true;
        }

        if (isApplicable) {
            // Apply maximum discount limit
            if (promo.maxDiscount) {
                promoAmount = Math.min(promoAmount, promo.maxDiscount);
            }

            totalPromotion += promoAmount;
            appliedPromotions.push({
                id: promo.id,
                name: promo.name,
                type: promo.type,
                discount: promo.discount,
                amount: Math.round(promoAmount)
            });
        }
    });

    return {
        amount: Math.round(totalPromotion),
        count: appliedPromotions.length,
        breakdown: appliedPromotions,
        applied: appliedPromotions.length > 0
    };
}

/**
 * Calculate booking fee
 */
function calculateBookingFee(context) {
    const bookingFeeConfig = context.settings.bookingFee || {
        enabled: true,
        amount: 200,
        waiveFor: ['premium', 'vip']
    };

    if (!bookingFeeConfig.enabled) {
        return {
            amount: 0,
            waived: false,
            reason: 'disabled'
        };
    }

    // Check if fee should be waived
    if (bookingFeeConfig.waiveFor && bookingFeeConfig.waiveFor.includes(context.ride.customerType)) {
        return {
            amount: 0,
            waived: true,
            reason: `waived_for_${context.ride.customerType}`
        };
    }

    return {
        amount: bookingFeeConfig.amount,
        waived: false,
        reason: 'standard_fee'
    };
}

/**
 * Calculate cancellation fee (for estimates)
 */
function calculateCancellationFee(context) {
    const cancellationConfig = context.settings.passengerRules || {
        cancellationFee: 1000,
        freeCancelWindow: 120 // 2 minutes
    };

    return {
        amount: cancellationConfig.cancellationFee,
        freeCancelWindow: cancellationConfig.freeCancelWindow,
        applicable: false // Only for estimates
    };
}

/**
 * Calculate tolls
 */
function calculateTolls(context) {
    // This would typically integrate with mapping service to detect toll roads
    const estimatedTolls = estimateTollCosts(context.ride.pickupLocation, context.ride.dropoffLocation);

    return {
        amount: estimatedTolls,
        estimated: true,
        note: 'Toll costs are estimates and may vary'
    };
}

/**
 * Calculate airport fee
 */
function calculateAirportFee(context) {
    const isAirportRide = checkIfAirportRide(context.ride.pickupLocation, context.ride.dropoffLocation);

    if (!isAirportRide) {
        return {
            amount: 0,
            applicable: false
        };
    }

    const airportFeeConfig = context.settings.airportFee || {
        amount: 500,
        enabled: true
    };

    return {
        amount: airportFeeConfig.enabled ? airportFeeConfig.amount : 0,
        applicable: isAirportRide,
        enabled: airportFeeConfig.enabled
    };
}

/**
 * Generate calculation metadata
 */
function generateCalculationMetadata(context) {
    return {
        calculatedAt: new Date(),
        version: '2.1.0',
        currency: context.settings.fare.currency,
        rideType: context.ride.isShared ? 'shared' : 'individual',
        vehicleType: context.ride.vehicleType,
        cityZone: context.market.cityZone,
        demandLevel: context.market.demandLevel,
        timeContext: {
            isNight: context.time.isNight,
            isWeekend: context.time.isWeekend,
            isPeakHour: context.time.isPeakHour,
            isHoliday: context.time.isHoliday
        },
        estimateOnly: context.options.estimateOnly
    };
}

/**
 * Calculate totals and subtotals
 */
function calculateTotals(fareBreakdown, context) {
    // Calculate subtotal (before discounts and taxes)
    const subtotal =
        fareBreakdown.baseFare.amount +
        fareBreakdown.distanceFare.amount +
        fareBreakdown.timeFare.amount +
        fareBreakdown.surgePricing.amount +
        fareBreakdown.demandMultiplier.amount +
        fareBreakdown.timeMultipliers.combined.totalAmount +
        fareBreakdown.serviceFee.amount +
        fareBreakdown.bookingFee.amount +
        fareBreakdown.tolls.amount +
        fareBreakdown.airportFee.amount;

    // Apply discounts and promotions
    const totalDiscounts = fareBreakdown.discounts.amount + fareBreakdown.promotions.amount;
    const afterDiscounts = subtotal - totalDiscounts;

    // Add taxes
    const totalTaxes = fareBreakdown.taxes.amount;
    const total = afterDiscounts + totalTaxes;

    return {
        subtotal: Math.round(subtotal),
        discounts: Math.round(totalDiscounts),
        afterDiscounts: Math.round(afterDiscounts),
        taxes: Math.round(totalTaxes),
        total: Math.round(total),
        breakdown: {
            fareComponents: Math.round(
                fareBreakdown.baseFare.amount +
                fareBreakdown.distanceFare.amount +
                fareBreakdown.timeFare.amount
            ),
            adjustments: Math.round(
                fareBreakdown.surgePricing.amount +
                fareBreakdown.demandMultiplier.amount +
                fareBreakdown.timeMultipliers.combined.totalAmount
            ),
            fees: Math.round(
                fareBreakdown.serviceFee.amount +
                fareBreakdown.bookingFee.amount +
                fareBreakdown.tolls.amount +
                fareBreakdown.airportFee.amount
            )
        }
    };
}

/**
 * Apply fare limits and validations
 */
function applyFareLimits(totals, context) {
    const settings = context.settings.fare;
    let finalAmount = totals.total;
    let adjustmentReason = null;

    // Apply minimum fare
    if (finalAmount < settings.minRidePrice) {
        finalAmount = settings.minRidePrice;
        adjustmentReason = 'minimum_fare_applied';
    }

    // Apply maximum fare
    if (finalAmount > settings.maxRidePrice) {
        finalAmount = settings.maxRidePrice;
        adjustmentReason = 'maximum_fare_applied';
    }

    // Round to nearest currency unit
    finalAmount = Math.round(finalAmount);

    return {
        amount: finalAmount,
        originalAmount: totals.total,
        adjusted: finalAmount !== totals.total,
        adjustmentReason: adjustmentReason,
        limits: {
            minimum: settings.minRidePrice,
            maximum: settings.maxRidePrice
        }
    };
}

/**
 * Generate detailed fare response
 */
function generateDetailedFareResponse(fareBreakdown, finalFare, context) {
    const roundedAmount = roundToNearest(finalFare.amount, 250);

    return {
        fare: {
            amount: roundedAmount,
            currency: context.settings.fare.currency,
            formatted: formatCurrency(roundedAmount, context.settings.fare.currency)
        },
        breakdown: context.options.breakdown ? {
            baseFare: fareBreakdown.baseFare,
            distanceFare: fareBreakdown.distanceFare,
            timeFare: fareBreakdown.timeFare,
            surgePricing: fareBreakdown.surgePricing,
            demandMultiplier: fareBreakdown.demandMultiplier,
            timeMultipliers: fareBreakdown.timeMultipliers,
            serviceFee: fareBreakdown.serviceFee,
            taxes: fareBreakdown.taxes,
            discounts: fareBreakdown.discounts,
            promotions: fareBreakdown.promotions,
            bookingFee: fareBreakdown.bookingFee,
            tolls: fareBreakdown.tolls,
            airportFee: fareBreakdown.airportFee
        } : null,
        summary: {
            subtotal: finalFare.originalAmount,
            adjustments: {
                applied: true,
                reason: 'rounded_to_nearest_250',
                originalAmount: finalFare.amount,
                adjustedAmount: roundedAmount
            },
            currency: context.settings.fare.currency
        },
        metadata: fareBreakdown.calculationMetadata,
        estimateValidity: {
            validFor: 300000,
            expiresAt: new Date(Date.now() + 300000)
        },
        cancellation: fareBreakdown.cancellationFee
    };
}

/**
 * Generate error response
 */
function generateErrorResponse(error, rideDetails, settings) {
    return {
        error: true,
        message: error.message,
        fallbackFare: {
            amount: settings?.fare?.baseFare || 3000,
            currency: settings?.fare?.currency || 'IQD',
            estimated: true
        },
        timestamp: new Date()
    };
}

// ===========================================================================================
// HELPER FUNCTIONS
// ===========================================================================================

function estimateDuration(distance) {
    // Estimate duration based on distance (assuming 30 km/h average speed)
    return Math.round((distance / 30) * 60); // minutes
}

function isPeakHour(date) {
    const hour = date.getHours();
    // Peak hours: 7-9 AM and 5-7 PM
    return (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
}

function isHoliday(date) {
    // This would check against a holiday calendar
    // For now, return false
    return false;
}

function getDemandLevel(rideDetails, time) {
    // This would integrate with real-time demand analytics
    // For now, return normal
    return 'normal';
}

function getCityZone(location) {
    // This would use geolocation to determine city zone
    if (!location || !location.coordinates) return 'unknown';

    // Simple zone determination (would be more sophisticated in production)
    return 'city_center';
}

function getSurgeReason(context) {
    if (context.time.isPeakHour) return 'peak_hour';
    if (context.market.demandLevel === 'very_high') return 'high_demand';
    if (context.time.isHoliday) return 'holiday';
    return 'market_conditions';
}

function getSurgeLevel(multiplier) {
    if (multiplier >= 2.0) return 'extreme';
    if (multiplier >= 1.5) return 'high';
    if (multiplier >= 1.2) return 'medium';
    return 'low';
}

function checkPromotionConditions(promo, context) {
    // This would check various promotion conditions
    // For now, return true for active promotions
    return promo.active && (!promo.minFare || context.settings.fare.baseFare >= promo.minFare);
}

function estimateTollCosts(pickupLocation, dropoffLocation) {
    // This would integrate with a mapping service to detect toll roads
    // For now, return 0
    return 0;
}

function checkIfAirportRide(pickupLocation, dropoffLocation) {
    // This would check if either location is near an airport
    // For now, return false
    return false;
}

function formatCurrency(amount, currency) {
    // Format currency based on locale
    if (currency === 'IQD') {
        return `${amount.toLocaleString('en-IQ')} IQD`;
    }
    return `${currency} ${amount.toLocaleString()}`;
}


// ===========================================================================================
// EXAMPLE USAGE
// ===========================================================================================

/**
 * A wrapper function to calculate fare based on coordinates.
 * @param {Object} pickupLocation - The pickup location with a coordinates array.
 * @param {Object} dropoffLocation - The dropoff location with a coordinates array.
 */
function getFareForCoordinates(pickupLocation, dropoffLocation) {
    // 1. Calculate the distance from the coordinates
    const distanceInKm = calculateDistance(pickupLocation.coordinates, dropoffLocation.coordinates);
    console.log(`Calculated distance: ${distanceInKm.toFixed(2)} km`);

    // 2. Construct the rideDetails object
    const rideDetails = {
        distance: distanceInKm,
        pickupLocation: pickupLocation,
        dropoffLocation: dropoffLocation,
        // You can add other details here, e.g., vehicleType
        vehicleType: 'standard'
    };

    // 3. Define the settings (in a real app, this would come from a database)
    const settings = {
        fare: {
            baseFare: 1500,        // Base fare in IQD
            pricePerKm: 450,         // Price per kilometer in IQD
            pricePerMinute: 50,      // Price per minute in IQD
            minRidePrice: 2500,      // Minimum fare in IQD
            maxRidePrice: 75000,     // Maximum fare in IQD
            currency: 'IQD'
        },
        serviceFee: {
            type: 'percentage',
            value: 0.10, // 10%
            minimum: 150,
            maximum: 1500
        },
        taxes: [
            { name: 'Municipal Tax', rate: 100, type: 'fixed' }
        ]
        // ... other settings
    };

    // 4. Call the main fare calculation function
    const fareResult = calculateRideFare(rideDetails, settings, { breakdown: true });

    // 5. Log the detailed result
    console.log(JSON.stringify(fareResult, null, 2));
}

// User's provided coordinates
const pickup = { "coordinates": [44.001, 36.333] };
const dropoff = { "coordinates": [44.056, 36.400] };

// Execute the calculation
getFareForCoordinates(pickup, dropoff);


// ===========================================================================================
// EXPORT
// ===========================================================================================

module.exports = {
    calculateRideFare,
    validateCalculationInputs,
    calculateDistance,
    getFareForCoordinates,
    estimateDuration,
    // Export individual calculation functions for testing
    calculateBaseFare,
    calculateDistanceFare,
    calculateTimeFare,
    calculateSurgePricing,
    calculateTimeMultipliers,
    calculateServiceFee,
    calculateTaxes,
    calculateDiscounts,
    calculatePromotions
};