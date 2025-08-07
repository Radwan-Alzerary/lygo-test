const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");      // ➊

const rideSchema = new mongoose.Schema(
  {
    rideCode: {                                // ➋ e.g. "A7F4C2"
      type: String,
      length: 6,
      unique: true,
      index: true,
      required: true,
    },

    passenger: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
    },

    pickupLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      locationName: { type: String }, // e.g., "University District"
      coordinates: { type: [Number], required: true },
    },
    dropoffLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      locationName: { type: String }, // e.g., "University District"
      coordinates: { type: [Number], required: true },
    },
    status: {
      type: String,
      enum: [
        "requested",
        "accepted",
        "arrived",
        "onRide",
        "awaiting_payment",
        "completed",
        "canceled",
        "cancelled",
        "notApprove",
      ],
      default: "requested",
    },
    fare: {
      amount: { type: Number, required: true },
      currency: { type: String, default: "IQD" },
    },
    distance: { type: Number, required: true }, // In kilometers or miles
    duration: { type: Number, required: true }, // In minutes
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "full", "partial", "waived"],
      default: "pending",
    },
    paymentDetails: {
      receivedAmount: { type: Number, default: 0 },
      expectedAmount: { type: Number },
      currency: { type: String, default: "IQD" },
      paymentMethod: { type: String, enum: ["cash", "card", "wallet"], default: "cash" },
      paymentTimestamp: { type: Date },
      reason: { type: String }, // For partial payments
      amountShortage: { type: Number }, // expectedAmount - receivedAmount
      paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" }
    },
    passengerRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null, // Default to null before rating is given
    },
    driverRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null, // Default to null before rating is given
    },
    isDispatching: {
      type: Boolean,
      default: false,
    },
    notified: {
      type: Boolean,
      default: false,
    },
    pickupAddress: { type: String },   // حي الجامعة، الموصل …
    dropoffAddress: { type: String },

  },
  {
    timestamps: true,
  }
);
rideSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    this.notified = false;          // let the next connection deliver the new status
  }
  next();
});
rideSchema.pre("validate", async function (next) {
  if (this.rideCode) return next();

  const Ride = this.constructor;
  let code;

  do {
    code = uuidv4().replace(/-/g, "").slice(0, 6).toUpperCase();
  } while (await Ride.exists({ rideCode: code }));   // avoid collision

  this.rideCode = code;
  next();
});
rideSchema.index({ rideCode: 1 }, { unique: true });

// Adding indexes for geospatial queries
rideSchema.index({ pickupLocation: "2dsphere" });
rideSchema.index({ dropoffLocation: "2dsphere" });

module.exports = mongoose.model("Ride", rideSchema);
