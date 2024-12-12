const mongoose = require("mongoose");

const placesSchema = new mongoose.Schema(
  {
    name: { type: String },
    anotherName: { type: String },
    country: { type: String },
    government: { type: String },
    priority: { type: Number },
    bookedTime: { type: Number },
    location: {
      type: { type: String, enum: ["Point"], required: true, default: "Point" },
      coordinates: { type: [Number], required: true },
    },
  },
  {
    timestamps: true,
  }
);

// Adding a 2dsphere index for geospatial queries
placesSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Place", placesSchema);
