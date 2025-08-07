const mongoose = require("mongoose");

const financialAccountSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
    required: true,
    index: true
  },
  accountType: {
    type: String,
    enum: ["captain", "customer", "admin", "main_vault", "system"],
    required: true,
    index: true
  },
  vault: { 
    type: Number, 
    default: 0,
    min: 0 // Prevent negative balances in main vault
  },
  currency: {
    type: String,
    default: "IQD",
    enum: ["IQD", "USD", "EUR"]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  transactions: [
    {
      moneyTransfers: [
        { type: mongoose.Schema.Types.ObjectId, ref: "MoneyTransfers" },
      ],
      date: { type: Date, default: Date.now },
      description: { type: String },
    },
  ],
  metadata: {
    createdBy: { type: String },
    purpose: { type: String },
    description: { type: String },
    lastMainVaultDeduction: { type: Date },
    totalMainVaultDeductions: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
financialAccountSchema.index({ user: 1, accountType: 1 }, { unique: true });

// Virtual for account display name
financialAccountSchema.virtual('displayName').get(function() {
  if (this.accountType === 'main_vault') {
    return 'Main System Vault';
  }
  return `${this.accountType.charAt(0).toUpperCase() + this.accountType.slice(1)} Account`;
});

module.exports = mongoose.model("FinancialAccount", financialAccountSchema);
