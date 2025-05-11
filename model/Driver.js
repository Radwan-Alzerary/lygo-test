const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const driverSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  profileImage: { type: String },
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
});
driverSchema.pre("save", async function (next) {
  const salt = await bcrypt.genSalt();
  this.password = await bcrypt.hash(this.password, salt);
  next();
});
driverSchema.statics.login = async function(email, password) {
  console.log("static login got:", { email, password });
  const user = await this.findOne({ email });
  console.log("found user:", user);
  if (!user) throw Error("incorrect email");
  const auth = await bcrypt.compare(password, user.password);
  console.log("bcrypt.compare result:", auth);
  if (!auth) throw Error("incorrect password");
  return user;
};
driverSchema.index({ currentLocation: "2dsphere" });

module.exports = mongoose.model("Driver", driverSchema);
