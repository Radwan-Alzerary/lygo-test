const authenticateToken = require("../middlewares/authenticateToken");

const router = require("express").Router();
router.use("/users", require("./users"));
router.use("/", require("./routes"));
// router.use("/auditos",authenticateToken, require("./auditos"));
// router.use("/department", require("./department"));
router.use("/customer", require("./customer"));
router.use("/financial",authenticateToken, require("./financial"));
router.use("/driver", require("./driver"));
router.use("/system",authenticateToken, require("./systemSetting"));
router.use("/ride", require("./ride"));
router.use("/places",authenticateToken, require("./places"));
router.get("/delete-account", (req, res) => {
  res.render("delete-account-phone");
});
router.post("/delete-account", require("../controllers/customerControllers").requestAccountDeletion);
router.get("/delete-account/verify", (req, res) => {
  const { phone } = req.query;
  res.render("delete-account-verify", { phone });
});
router.post("/delete-account/verify", require("../controllers/customerControllers").verifyDeletionOtp);


module.exports = router;