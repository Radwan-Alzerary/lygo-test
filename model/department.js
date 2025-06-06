const mongoose = require("mongoose");
const DepartmentSchema = new mongoose.Schema(
  {
    name: { type: String },
  },
  {
    timestamps: true,
  }
);
const Department = mongoose.model("Department", DepartmentSchema);

module.exports = Department;
