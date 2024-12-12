const User = require("../model/user");
const jwt = require("jsonwebtoken");

module.exports.checkUser = async (req, res, next) => {
  const token = req.cookies.jwt;
console.log("tokenCheck",token)
  if (token) {
    jwt.verify(
      token,
      "kishan sheth super secret key",
      async (err, decodedToken) => {
        if (err) {
          res.json({ status: false });
          next();
        } else {
          const user = await User.findById(decodedToken.id);
          if (user)
            res.json({
              status: true,
              user: user.email,
              userId: user._id,
              userName: user.userName,
              role: user.role,
              financialAccount:user.financialAccount
            });
          else res.json({ status: false });
          next();
        }
      }
    );
  } else {
    res.json({ status: false });
    next();
  }
};
const { jwtSecret } = require('../config');

module.exports.authMiddleware = (socket, next) => {
  const token = socket.handshake.query.token;
  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      console.error('JWT verification failed:', err);
      return next(new Error('Authentication error'));
    }
    socket.userId = decoded.id;
    next();
  });
};

