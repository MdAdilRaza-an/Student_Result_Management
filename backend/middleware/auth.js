const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized access. Please login again.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'student_result_system_secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Your session is invalid or expired.' });
  }
}

module.exports = {
  authenticateToken,
};
