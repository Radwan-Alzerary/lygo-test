const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    name: { type: String },
    phoneNumber: { type: String, required: true},
    email: { type: String,  },

    rideHistory: [
      {
        rideId: { type: mongoose.Schema.Types.ObjectId },
      },
    ],
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
