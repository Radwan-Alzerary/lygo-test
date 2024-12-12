const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema(
  {
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
      coordinates: { type: [Number], required: true },
    },
    dropoffLocation: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    status: {
      type: String,
      enum: [
        "requested",
        "accepted",
        "arrived",
        "onRide",
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
      enum: ["pending", "paid"],
      default: "pending",
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
  },
  {
    timestamps: true,
  }
);

// Adding indexes for geospatial queries
rideSchema.index({ pickupLocation: "2dsphere" });
rideSchema.index({ dropoffLocation: "2dsphere" });

module.exports = mongoose.model("Ride", rideSchema);
