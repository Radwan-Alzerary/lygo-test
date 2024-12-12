const { registerPhoneNumber, verifyOtp } = require("../controllers/customerControllers");
const customer = require("../model/customer");

const router = require("express").Router();

router.post("/registerPhoneNumber", registerPhoneNumber);
router.post("/otpcheck", verifyOtp);

module.exports = router;
