const jwt = require("jsonwebtoken");

const authenticateUser = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) return res.status(401).json({ message: "Access denied." });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return res.status(403).json({ message: "Invalid token." });
      req.user = { id: decoded.id, email: decoded.email };
      next();
    });
  } catch (err) {
    res.status(500).json({ message: "Auth Error" });
  }
};

module.exports = authenticateUser;