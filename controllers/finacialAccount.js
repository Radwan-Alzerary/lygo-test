const Driver = require("../model/Driver");
exports.transferMoneyFromUserToDriver = async (req, res) => {
    try {
      const drivers = await Driver.find();
      res.status(200).json(drivers);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  };