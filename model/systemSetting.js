const mongoose = require("mongoose");
const SystemSettingSchema = new mongoose.Schema(
  {
    name: { type: String },
    screenAdv: [
      {
        text: { type: String },
        advType: { type: String },
        speed: { type: String },
        color: { type: String },
        fontType: { type: String },
        x: { type: Number },
        y: { type: Number },
      },
    ],
    screenImg: { type: "String" },
  },
  {
    timestamps: true,
  }
);
const SystemSetting = mongoose.model("SystemSetting", SystemSettingSchema);

module.exports = SystemSetting;
