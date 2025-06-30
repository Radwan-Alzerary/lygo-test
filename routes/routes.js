const router = require('express').Router();

router.get('/', async (req, res) => {
  res.render("main")
})
router.use("/api", require("./ap"));
router.use("/api", require("./upload"));
router.use("/api/advertisements", require("./advertisements"));


module.exports = router;
