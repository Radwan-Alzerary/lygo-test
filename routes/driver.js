const router = require("express").Router();

const driverController = require("../controllers/driverController");

router.get("/", driverController.getDrivers);
router.get("/:id", driverController.getDriver);
router.put("/:id", driverController.upload, driverController.updateDriver);
router.delete("/:id", driverController.deleteDriver);
router.post("/register",driverController.upload, driverController.register);
router.post("/login", driverController.upload, driverController.login);

module.exports = router;
