const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
//   console.log(token)
  console.log(req.headers);

  if (!token) {
    // If no token is found, respond with a 401 Unauthorized status
    return res.status(401).json({ message: 'Access token is missing or invalid' });
  }

  // Verify the token
  jwt.verify(token, 'kishan sheth super secret key', (err, user) => {
    if (err) {
      // If token verification fails, respond with a 403 Forbidden status
      return res.status(403).json({ message: 'Token is not valid' });
    }

    // If the token is valid, attach the user info to the req object
    req.user = user;

    // Proceed to the next middleware or route handler
  });
  
  next();

};

module.exports = authenticateToken;
