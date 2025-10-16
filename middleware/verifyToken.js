const jwt = require('jsonwebtoken');

// Kiểm tra token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(" ")[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json("Token is not valid!");
      }
      req.user = user; // 👈 user sẽ có {id, userType, email}
      next();
    });
  } else {
    return res.status(401).json("You are not authenticated!");
  }
};

// Cho phép mọi role hợp lệ
const verifyTokenAndAuthorization = (req, res, next) => {
  verifyToken(req, res, () => {
    if (
      req.user.userType === 'Client' ||
      req.user.userType === 'Admin' ||
      req.user.userType === 'Vendor' ||
      req.user.userType === 'Driver'
    ) {
      next();
    } else {
      res.status(403).json("You are not allowed to do that!");
    }
  });
};

const verifyVendor = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.userType === 'Admin' || req.user.userType === 'Vendor') {
      next();
    } else {
      res.status(403).json("You are not allowed to do that!");
    }
  });
};

const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.userType === 'Admin') {
      next();
    } else {
      res.status(403).json("You are not allowed to do that!");
    }
  });
};

const verifyDriver = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.userType === 'Driver') {
      next();
    } else {
      res.status(403).json("You are not allowed to do that!");
    }
  });
};

module.exports = {
  verifyToken,
  verifyTokenAndAuthorization,
  verifyVendor,
  verifyAdmin,
  verifyDriver,
};
