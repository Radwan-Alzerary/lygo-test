const jwt = require("jsonwebtoken");

const maxAge = 3000 * 24 * 60 * 60; // Token expiration time in seconds (3 days)
const secretKey = "hello "; // Replace with your actual secret key

const createToken = (id) => {
  return jwt.sign({ id }, secretKey, {
    expiresIn: maxAge,
  });
};

module.exports = {
    createToken,
  };
  