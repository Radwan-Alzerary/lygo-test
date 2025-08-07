const express = require('express');
const router = express.Router();
const { calculateRideFare, calculateDistance, estimateDuration } = require('../utils/fareCalculator');
const RideSetting = require('../model/rideSetting');
const StateManagementService = require('../services/stateManagementService');
const authenticateToken = require('../middlewares/authenticateToken');

// Initialize state management service (will be injected later)
let stateManagementService = null;

/**
 * Middleware to inject state management service
 */
router.use((req, res, next) => {
  if (!stateManagementService && req.stateManagementService) {
    stateManagementService = req.stateManagementService;
  }
  next();
});

/**
 * POST /api/calculate-fare
 * حساب تكلفة الرحلة
 */
router.post('/calculate-fare', authenticateToken, async (req, res) => {
  try {
    const {
      origin,
      destination,
      waypoints = [],
      carType = 'standard',
      roundTrip = false,
      promoCode,
      scheduledTime
    } = req.body;

    // التحقق من صحة البيانات المطلوبة
    if (!origin || !destination) {
      return res.status(400).json({
        success: false,
        message: 'نقطة الانطلاق ونقطة الوصول مطلوبة',
        error: 'Missing required origin and destination'
      });
    }

    if (!origin.latitude || !origin.longitude || !destination.latitude || !destination.longitude) {
      return res.status(400).json({
        success: false,
        message: 'إحداثيات غير صحيحة',
        error: 'Invalid coordinates provided'
      });
    }

    // بناء بيانات الرحلة لحساب التكلفة
    const fareData = {
      origin: {
        latitude: parseFloat(origin.latitude),
        longitude: parseFloat(origin.longitude)
      },
      destination: {
        latitude: parseFloat(destination.latitude),
        longitude: parseFloat(destination.longitude)
      },
      waypoints: waypoints.map(point => ({
        latitude: parseFloat(point.latitude),
        longitude: parseFloat(point.longitude)
      })),
      vehicleType: carType,
      isShared: false,
      roundTrip,
      scheduledTime: scheduledTime ? new Date(scheduledTime) : null
    };

    // حساب المسافة بين نقطة الانطلاق والوصول
    const distance = calculateDistance(
      [fareData.origin.longitude, fareData.origin.latitude],
      [fareData.destination.longitude, fareData.destination.latitude]
    );

    // تقدير مدة الرحلة
    const estimatedDuration = estimateDuration(distance);

    // إعداد بيانات مكتملة للرحلة
    const completeRideData = {
      ...fareData,
      distance: distance,
      duration: estimatedDuration,
      requestTime: new Date(),
      rideType: 'individual', // افتراضي
      pickupLocation: {
        type: 'Point',
        coordinates: [fareData.origin.longitude, fareData.origin.latitude],
        address: origin.address || 'نقطة الانطلاق'
      },
      dropoffLocation: {
        type: 'Point', 
        coordinates: [fareData.destination.longitude, fareData.destination.latitude],
        address: destination.address || 'نقطة الوصول'
      }
    };

    // الحصول على إعدادات الرحلة من قاعدة البيانات
    const RideSettings = require('../model/rideSetting');
    const rideSettings = await RideSettings.findOne().exec();
    
    if (!rideSettings) {
      return res.status(500).json({
        success: false,
        message: 'لم يتم العثور على إعدادات الرحلة',
        error: 'Ride settings not found'
      });
    }

    // حساب التكلفة الأساسية
    const fareCalculation = calculateRideFare(completeRideData, rideSettings);
    
    if (!fareCalculation || !fareCalculation.fare) {
      return res.status(500).json({
        success: false,
        message: 'فشل في حساب تكلفة الرحلة',
        error: 'Fare calculation failed'
      });
    }

    let finalFare = fareCalculation.fare.amount;
    let discount = 0;
    let promoCodeDetails = null;

    // تطبيق كود الخصم إن وجد
    if (promoCode && stateManagementService) {
      const promoValidation = await stateManagementService.validatePromoCode({
        promoCode,
        userId: req.user.id,
        estimatedFare: finalFare,
        origin: fareData.origin,
        destination: fareData.destination,
        distance: fareCalculation.metadata?.distance || 0,
        selectedCarType: carType
      });

      if (promoValidation.isValid) {
        discount = promoValidation.discount;
        finalFare = promoValidation.newFare;
        promoCodeDetails = {
          code: promoCode,
          discount: discount,
          type: promoValidation.promoType,
          message: promoValidation.message
        };
      } else {
        // لا نفشل الطلب بسبب كود خصم غير صحيح، نرسل تحذير فقط
        promoCodeDetails = {
          code: promoCode,
          isValid: false,
          message: promoValidation.reason
        };
      }
    }

    // بناء الاستجابة
    const response = {
      success: true,
      fare: {
        originalAmount: fareCalculation.fare.amount,
        finalAmount: finalFare,
        currency: fareCalculation.fare.currency,
        formatted: new Intl.NumberFormat('ar-IQ').format(finalFare) + ' ' + fareCalculation.fare.currency
      },
      distance: fareCalculation.metadata?.distance || 0,
      duration: fareCalculation.metadata?.duration || 0,
      discount: discount,
      ...(promoCodeDetails && { promoCode: promoCodeDetails }),
      breakdown: fareCalculation.breakdown,
      metadata: {
        ...fareCalculation.metadata,
        carType,
        roundTrip,
        waypoints: waypoints.length,
        calculatedAt: new Date().toISOString()
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Fare calculation error:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في حساب تكلفة الرحلة',
      error: error.message
    });
  }
});

/**
 * POST /api/promo-code/validate
 * التحقق من صحة كود الخصم
 */
router.post('/promo-code/validate', authenticateToken, async (req, res) => {
  try {
    const {
      promoCode,
      origin,
      destination,
      distance,
      selectedCarType = 'standard',
      estimatedFare
    } = req.body;

    // التحقق من البيانات المطلوبة
    if (!promoCode) {
      return res.status(400).json({
        success: false,
        message: 'كود الخصم مطلوب',
        error: 'Promo code is required'
      });
    }

    if (!estimatedFare || estimatedFare <= 0) {
      return res.status(400).json({
        success: false,
        message: 'تكلفة الرحلة المقدرة مطلوبة',
        error: 'Valid estimated fare is required'
      });
    }

    if (!stateManagementService) {
      return res.status(503).json({
        success: false,
        message: 'خدمة التحقق من أكواد الخصم غير متوفرة حالياً',
        error: 'State management service not available'
      });
    }

    // بيانات التحقق من كود الخصم
    const promoData = {
      promoCode: promoCode.trim().toUpperCase(),
      userId: req.user.id,
      estimatedFare: parseFloat(estimatedFare),
      origin,
      destination,
      distance: distance || 0,
      selectedCarType
    };

    // التحقق من كود الخصم
    const validation = await stateManagementService.validatePromoCode(promoData);

    if (validation.isValid) {
      res.json({
        success: true,
        discount: validation.discount,
        newFare: validation.newFare,
        promoType: validation.promoType,
        message: validation.message,
        savings: {
          amount: validation.discount,
          percentage: Math.round((validation.discount / promoData.estimatedFare) * 100),
          formatted: new Intl.NumberFormat('ar-IQ').format(validation.discount) + ' دينار'
        }
      });
    } else {
      res.json({
        success: false,
        message: validation.reason || 'كود خصم غير صالح',
        promoCode: promoData.promoCode
      });
    }

  } catch (error) {
    console.error('Promo code validation error:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في التحقق من كود الخصم',
      error: error.message
    });
  }
});

/**
 * GET /api/ride-settings
 * الحصول على إعدادات الرحلة الحالية
 */
router.get('/ride-settings', authenticateToken, async (req, res) => {
  try {
    const rideSettings = await RideSetting.findOne({ name: 'default' });

    if (!rideSettings) {
      return res.status(404).json({
        success: false,
        message: 'إعدادات الرحلة غير موجودة'
      });
    }

    res.json({
      success: true,
      settings: {
        fare: {
          currency: rideSettings.fare.currency,
          baseFare: rideSettings.fare.baseFare,
          pricePerKm: rideSettings.fare.pricePerKm,
          pricePerMinute: rideSettings.fare.pricePerMinute || 0,
          minRidePrice: rideSettings.fare.minRidePrice,
          maxRidePrice: rideSettings.fare.maxRidePrice,
          surge: rideSettings.fare.surge || { enabled: false }
        },
        paymentMethods: rideSettings.paymentMethods || ['cash'],
        allowShared: rideSettings.allowShared || false,
        cancellationPolicy: {
          fee: rideSettings.passengerRules?.cancellationFee || 1000,
          freeCancelWindow: rideSettings.passengerRules?.freeCancelWindow || 120
        },
        supportedCarTypes: ['standard', 'economy', 'premium'], // يمكن جعلها ديناميكية
        features: {
          roundTrip: true,
          scheduledRides: true,
          waypoints: true,
          promoCodes: true
        }
      }
    });

  } catch (error) {
    console.error('Error fetching ride settings:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب إعدادات الرحلة',
      error: error.message
    });
  }
});

/**
 * GET /api/available-promo-codes
 * الحصول على أكواد الخصم المتاحة (للاختبار فقط)
 */
router.get('/available-promo-codes', authenticateToken, async (req, res) => {
  try {
    // هذا endpoint للاختبار فقط - في الواقع لا يجب عرض جميع أكواد الخصم
    const availablePromoCodes = [
      {
        code: 'LYGO10',
        discount: 10,
        type: 'percentage',
        description: 'خصم 10% على جميع الرحلات',
        maxUse: 100,
        active: true
      },
      {
        code: 'WELCOME20',
        discount: 20,
        type: 'percentage',
        description: 'خصم 20% للعملاء الجدد',
        maxUse: 1,
        firstTimeOnly: true,
        active: true
      },
      {
        code: 'SAVE5000',
        discount: 5000,
        type: 'fixed',
        description: 'خصم 5000 دينار عراقي',
        maxUse: 50,
        active: true
      }
    ];

    res.json({
      success: true,
      promoCodes: availablePromoCodes,
      note: 'هذه القائمة للاختبار فقط'
    });

  } catch (error) {
    console.error('Error fetching promo codes:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب أكواد الخصم',
      error: error.message
    });
  }
});

module.exports = router;
