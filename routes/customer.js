const { registerPhoneNumber, verifyOtp, deleteAccount } = require("../controllers/customerControllers");
const authenticateToken = require("../middlewares/authenticateToken");
const customer = require("../model/customer");

const router = require("express").Router();

router.post("/registerPhoneNumber", registerPhoneNumber);
router.post("/otpcheck", verifyOtp);
router.post(
  "/delete-account",
  authenticateToken,
  deleteAccount
);

module.exports = router;
