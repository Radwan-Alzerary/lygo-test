const Customer = require("../model/customer");
const FinancialAccount = require("../model/financialAccount");
const { handleErrors } = require("../utils/errorHandler");
const axios = require("axios");
const jwt = require("jsonwebtoken");


const maxAge = 3000 * 24 * 60 * 60;
const createToken = (id) => {
  return jwt.sign({ id }, "kishan sheth super secret key", {
    expiresIn: maxAge,
  });
};




module.exports.registerPhoneNumber = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;
    // Check if the customer already exists
    let customer = await Customer.findOne({ phoneNumber: phoneNumber });

    console.log(customer);
    if (!customer) {
      const financialAccount = new FinancialAccount();
      await financialAccount.save();

      customer = new Customer({
        phoneNumber: phoneNumber,
        financialAccount: financialAccount._id,
      });

      await customer.save();
    }

    // // Send the OTP via your own WhatsApp server
    // const response = await axios.post("http://localhost:3004/register", {
    //   phone: phoneNumber,
    // });

    if (1) {
      res.status(200).json({ message: "OTP sent via WhatsApp" });
    } else {
      res.status(500).json({ message: "Failed to send OTP" });
    }
    // if (response.data === "OTP sent via WhatsApp") {
    //   res.status(200).json({ message: "OTP sent via WhatsApp" });
    // } else {
    //   res.status(500).json({ message: "Failed to send OTP" });
    // }

  } catch (err) {
    console.log(err);
    const errors = handleErrors(err);
    res.json({ errors, sent: false });
  }
};

module.exports.verifyOtp = async (req, res, next) => {
  try {
    const { phoneNumber, otp } = req.body;
    console.log(phoneNumber, otp);
    
    // Verify the OTP via your own WhatsApp server
    // https://api.toxlyiq.com/verify
    // const response = await axios.post("http://localhost:3004/verify", {
    //   phone: phoneNumber.toString(),
    //   otp: otp.toString(),
    // });

    if (1) {
      // OTP is valid, create JWT token
      const customer = await Customer.findOne({ phoneNumber });

      if (!customer) {
        return res.status(400).json({ message: "Customer not found" });
      }

      const token = createToken(customer._id);

      // Set the JWT token in the response
      res.cookie("jwt", token, {
        withCredentials: true,
        httpOnly: false,
        maxAge: maxAge * 1000,
      });

      res
        .status(200)
        .json({ token, message: "OTP verified and JWT token created" });
    } else {
      res.status(400).json({ message: "Invalid or expired OTP" });
    }
  } catch (err) {
    console.log(err.message);
    const errors = handleErrors(err);
    res.json({ errors, verified: false });
  }
};
