const Driver = require("../model/Driver");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
const FinancialAccount = require("../model/financialAccount");
const maxAge = 3 * 24 * 60 * 60;

const createToken = (id) => {
  return jwt.sign({ id }, "kishan sheth super secret key", {});
};

const handleErrors = (err) => {
  const handleNewDriver = async (data) => {
    let errors = { email: "", password: "" };

    try {
      const response = await axios.post(API_ENDPOINTS.postNewDriver, data, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      console.log(response.data);
      setShowAddDriver(false);
    } catch (error) {
      if (error.response) {
        const err = error.response.data;

        console.log(err);

        if (err.message === "incorrect email") {
          errors.email = "That email is not registered";
        }

        if (err.message === "incorrect password") {
          errors.password = "That password is incorrect";
        }

        if (err.code === 11000) {
          errors.email = "Email is already registered";
          return errors;
        }

        if (err.message.includes("Users validation failed")) {
          Object.values(err.errors).forEach(({ properties }) => {
            errors[properties.path] = properties.message;
          });
        }

        // Handle additional server error responses here if necessary
      } else if (error.request) {
        console.error("Error request:", error.request);
      } else {
        console.error("Error message:", error.message);
      }
      console.error("Error config:", error.config);
    }

    return errors;
  };
};

// Multer setup for image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/img/captainImg");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// Create a new driver

module.exports.register = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      phoneNumber,
      age,
      address,
      IDNumber,
      carDetails,
    } = req.body;
    const financialAccount = new FinancialAccount();
    await financialAccount.save();
    console.log(req.file);
    const imagePath = req.file ? "/img/captainImg/" + req.file.filename : null;
    const driver = new Driver({
      name,
      email,
      password,
      age,
      address,
      IDNumber,
      phoneNumber,
      profileImage: imagePath,
      carDetails: carDetails,
      image: imagePath ?? "",
      financialAccount: financialAccount._id,
    });

    await driver.save();
    const token = createToken(driver._id);

    res.cookie("jwt", token, {
      withCredentials: true,
      httpOnly: false,
      maxAge: maxAge * 1000,
    });

    res.status(201).json({ driver: driver._id, created: true });
  } catch (err) {
    console.log(err);
    const errors = handleErrors(err);
    res.json({ errors, created: false });
  }
};

module.exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await Driver.login(email, password);
    const token = createToken(user._id);
    res.cookie("jwt", token, {
      withCredentials: true,
      httpOnly: false,
      maxAge: maxAge * 1000,
    });
    res.status(200).json({ user: user._id, status: true, token });
  } catch (err) {
    const errors = handleErrors(err);
    res.json({ errors, status: false });
  }
};

// Get all drivers
exports.getDrivers = async (req, res) => {
  try {
    const drivers = await Driver.find().populate("financialAccount");
    res.status(200).json(drivers);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get a single driver by ID
exports.getDriver = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    res.status(200).json(driver);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update a driver
exports.updateDriver = async (req, res) => {
  try {
    const { name, email, password, phoneNumber, carDetails, coordinates } =
      req.body;
    const profileImage = req.file ? req.file.path : null;

    const updatedData = {
      name,
      email,
      password,
      phoneNumber,
      carDetails,
      currentLocation: {
        type: "Point",
        coordinates: coordinates.split(",").map(Number),
      },
    };

    if (profileImage) {
      updatedData.profileImage = profileImage;
    }

    const driver = await Driver.findByIdAndUpdate(req.params.id, updatedData, {
      new: true,
    });
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    res.status(200).json(driver);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete a driver
exports.deleteDriver = async (req, res) => {
  try {
    const driver = await Driver.findByIdAndDelete(req.params.id);
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    res.status(200).json({ message: "Driver deleted" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Image upload middleware
exports.upload = upload.single("image");
