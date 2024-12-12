const mongoose = require("mongoose");

const rechargeCardSchema = new mongoose.Schema(
  {
    serialNumber: { type: Number },
    vault: { type: Number },
    moneyTransfers: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "moneyTransfers",
    },
    active: { type: Boolean, default: true },
    from: {
      id: { type: mongoose.Schema.Types.ObjectId, required: true },
      role: {
        type: String,
        enum: ["Customer", "Driver", "Users"],
        required: true,
      },
    },
    to: {
      id: { type: mongoose.Schema.Types.ObjectId, required: true },
      role: {
        type: String,
        enum: ["Customer", "Driver", "Users"],
        required: true,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RechargeCard", rechargeCardSchema);