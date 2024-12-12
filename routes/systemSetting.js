const SystemSetting = require("../model/systemSetting");

const router = require("express").Router();
router.put("/system-settings/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, screenAdv, screenImg } = req.body;
      const systemSetting = await SystemSetting.findByIdAndUpdate(
        id,
        { name, screenAdv, screenImg },
        { new: true }
      );
      res.status(200).send(systemSetting);
    } catch (error) {
      res.status(400).send(error);
    }
  });
  
  router.get("/system-settings", async (req, res) => {
    try {
      const systemSetting = await SystemSetting.findOne();
      res.status(200).send(systemSetting);
    } catch (error) {
      res.status(400).send(error);
    }
  });
  
  module.exports = router;
