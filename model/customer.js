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
