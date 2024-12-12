const mongoose = require("mongoose");

const financialAccountSchema = new mongoose.Schema({
  vault: { type: Number, default: 0 },
  transactions: [
    {
      moneyTransfers: [
        { type: mongoose.Schema.Types.ObjectId, ref: "moneyTransfers" },
      ],
      date: { type: Date, default: Date.now },
      description: { type: String },
    },
  ],
});

module.exports = mongoose.model("FinancialAccount", financialAccountSchema);
