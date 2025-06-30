const router = require('express').Router();

router.get('/', async (req, res) => {
  res.render("main")
})
router.use("/api", require("./v0"));
router.use("/api", require("./upload"));


module.exports = router;
