const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const driverSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phoneNumber: { type: String, required: true }, // This will be one phone number
  whatsAppPhoneNumber: { type: String, required: true }, // Second phone number, must have WhatsApp
  profileImage: { type: String }, // URL to the image

  // Document Images (URLs to the images)
  drivingLicenseFrontImage: { type: String }, // صورة اجازه السوق وجه
  drivingLicenseBackImage: { type: String },  // صورة اجازه السوق ضهر
  vehicleAnnualInspectionFrontImage: { type: String }, // صورة سنويه السيارة وجه
  vehicleAnnualInspectionBackImage: { type: String },  // صورة سنويه السيارة ضهر
  goldenSquareFrontImage: { type: String }, // صوره المربع الذهبي وجه (Often a permit or specific registration card)
  goldenSquareBackImage: { type: String },  // صوره المربع الذهبي ضهر

  // Car Images (URLs to the images)
  carInteriorImage: { type: String }, // صوره داخل السياره
  carExteriorImage: { type: String }, // صوره خارج السياره

  active: { type: Boolean, default: true },
  carDetails: {
    make: { type: String },
    model: { type: String },
    licensePlate: { type: String },
    color: { type: String },
  },
  age: { type: Number },
  address: { type: String },
  rideHistory: [{ type: mongoose.Schema.Types.ObjectId, ref: "Ride" }],
  isAvailable: { type: Boolean, default: true },
  financialAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FinancialAccount",
  },
  // Assuming currentLocation is added elsewhere or handled differently now.
  // If you need it for geo-queries, you should add it:
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], index: '2dsphere' } // [longitude, latitude]
  }
});

// Password Hashing
driverSchema.pre("save", async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt();
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Static method to login user
driverSchema.statics.login = async function(email, password) {
  console.log("static login got:", { email, password });
  const user = await this.findOne({ email });
  console.log("found user:", user);
  if (!user) {
    throw Error("incorrect email");
  }
  const auth = await bcrypt.compare(password, user.password);
  console.log("bcrypt.compare result:", auth);
  if (!auth) {
    throw Error("incorrect password");
  }
  return user;
};
 driverSchema.methods.setAvailability = async function (active) {
   this.isAvailable = active;
   return this.save();         // يعيد السطر المحفوظ (Promise)
 };

// Geospatial index if you store driver's location directly in this schema
// driverSchema.index({ currentLocation: "2dsphere" });
// Note: If `currentLocation` is not part of this schema, this index will not apply.
// You had it in the original code, so I'm keeping it commented in case you re-add the field.

module.exports = mongoose.model("Driver", driverSchema);