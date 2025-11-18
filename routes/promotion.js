// Promotions API disabled
const router = require('express').Router();
router.use((_req, res) => res.status(404).json({ status: false, message: 'Promotions API disabled' }));
module.exports = router;