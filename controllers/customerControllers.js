// controllers/authController.js
const Customer         = require("../model/customer");
const FinancialAccount = require("../model/financialAccount");
const { handleErrors } = require("../utils/errorHandler");
const axios            = require("axios");
const jwt              = require("jsonwebtoken");

const OTP_SERVER_URL = process.env.OTP_SERVER_URL || "https://otp.niuraiq.com";

const maxAge = 3000 * 24 * 60 * 60; // your JWT TTL
const createToken = (id) => {
  return jwt.sign({ id }, "kishan sheth super secret key", {
    expiresIn: maxAge,
  });
};
module.exports.deleteAccount = async (req, res, next) => {
  try {
    // 1. get the user ID from your authenticateToken middleware
    const userId = req.user.id;

    // 2. delete the user document
    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 3. (optional) clear any auth cookies
    res.clearCookie("jwt", { path: "/" });

    // 4. send confirmation
    return res.json({ message: "Your account and all data have been deleted." });
  } catch (err) {
    next(err);
  }
};

module.exports.registerPhoneNumber = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res
        .status(400)
        .json({ message: "phoneNumber and project are required" });
    }

    // 1) ensure customer + financialAccount
    let customer = await Customer.findOne({ phoneNumber });
    if (!customer) {
      const financialAccount = new FinancialAccount();
      await financialAccount.save();

      customer = new Customer({
        phoneNumber,
        project:"lygo",
        financialAccount: financialAccount._id,
      });
      await customer.save();
    }

    // 2) call OTP server
    const otpRes = await axios.post(`${OTP_SERVER_URL}/otp/send`, {
      phone: phoneNumber,
      project:"lygo",
    });

    if (otpRes.data && otpRes.data.success) {
      return res
        .status(200)
        .json({ message: "OTP sent via WhatsApp" });
    } else {
      return res
        .status(500)
        .json({ message: "Failed to send OTP" });
    }
  } catch (err) {
    console.error("[registerPhoneNumber] error:", err);
    const errors = handleErrors(err);
    return res.status(500).json({ errors, sent: false });
  }
};

module.exports.verifyOtp = async (req, res, next) => {
  try {
    const { phoneNumber, otp } = req.body;
    if (!phoneNumber || !otp) {
      return res
        .status(400)
        .json({ message: "phoneNumber, project, and otp are required" });
    }

    // call OTP server to verify
    const verifyRes = await axios.post(`${OTP_SERVER_URL}/otp/verify`, {
      phone: phoneNumber.toString(),
      project: "lygo",
      otp: otp.toString(),
    });

    if (verifyRes.data && verifyRes.data.accepted) {
      // OTP valid → issue JWT
      const customer = await Customer.findOne({ phoneNumber });
      if (!customer) {
        return res.status(400).json({ message: "Customer not found" });
      }

      const token = createToken(customer._id);
      res.cookie("jwt", token, {
        withCredentials: true,
        httpOnly: false,
        maxAge: maxAge * 1000,
      });

      return res.status(200).json({
        token,
        message: "OTP verified and JWT token created",
      });
    } else {
      // OTP rejected
      const errMsg =
        verifyRes.data.error || "Invalid or expired OTP";
      return res.status(400).json({ message: errMsg });
    }
  } catch (err) {
    console.error("[verifyOtp] error:", err.message);
    const errors = handleErrors(err);
    return res.status(500).json({ errors, verified: false });
  }
};
