const mongoose = require("mongoose");
const AuditorsSchema = new mongoose.Schema(
  {
    name: { type: String },
    from:{type:String},
    department:{type: mongoose.Schema.Types.ObjectId, ref: "Department"},
    state:{type:String},
    sequence:{type:Number,default:1},
    expire :{type:Date},
    ExaminerProcedureDate:{type:Date},
    Examinername:{type: mongoose.Schema.Types.ObjectId, ref: "Users"},
    ExaminerFinish:{type:Boolean,default:false},
    addDate:{type:Date}
  },
  {
    timestamps: true,
  }
);
const Auditors = mongoose.model("Auditors", AuditorsSchema);

module.exports = Auditors;
