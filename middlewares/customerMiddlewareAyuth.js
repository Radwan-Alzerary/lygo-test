const jwt = require('jsonwebtoken');

// Middleware function to verify the token
const verifyToken = (req, res, next) => {
  // Get token from headers
  const token = req.headers['authorization']?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      message: 'No token provided, authorization denied',
    });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Store the decoded user data in the request object
    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    return res.status(401).json({
      message: 'Token is not valid',
    });
  }
};

module.exports = {
  verifyToken,
};
