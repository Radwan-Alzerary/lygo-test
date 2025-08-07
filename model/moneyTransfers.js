const mongoose = require("mongoose");

const moneyTransfersSchema = new mongoose.Schema({
  vault: { type: Number, default: 0 },
  transferType: { type: String, required: true },
  status: { 
    type: String, 
    enum: ["completed", "pending", "failed"], 
    default: "completed" 
  },
  from: { 
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ["Customer", "Driver", "Users"], required: true }
  },
  to: { 
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ["Customer", "Driver", "Users"], required: true }
  },
}, { timestamps: true });

module.exports = mongoose.model("MoneyTransfers", moneyTransfersSchema);