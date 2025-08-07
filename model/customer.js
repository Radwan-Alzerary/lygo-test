const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    name: { type: String },
    phoneNumber: { type: String, required: true },
    email: { type: String, },
    isActive: { type: Boolean, default: true },
    
    rideHistory: [
      {
        rideId: { type: mongoose.Schema.Types.ObjectId },
      },
    ],

    notifyToken: {
      type: String,
      default: "",
    },

    token: { type: String }, // For storing JWT or other auth tokens
    
    // Financial fields for better tracking
    walletBalance: { type: Number, default: 0 }, // Current wallet balance
    totalSpent: { type: Number, default: 0 }, // Total amount spent on rides
    totalRides: { type: Number, default: 0 }, // Total completed rides
    
    financialAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialAccount",
    },
  },
  {
    timestamps: true,
  }
);

// Adding index for geospatial queries
customerSchema.index({ currentLocation: "phoneNumber" });

module.exports = mongoose.model("Customer", customerSchema);
