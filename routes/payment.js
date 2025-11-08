const router = require('express').Router();
const { vnpayReturn, vnpayIpn } = require('../controllers/paymentController');

// VNPay browser return callback
router.get('/vnpay/vnpay_return', vnpayReturn);

// VNPay IPN (server-to-server)
router.get('/vnpay/vnpay_ipn', vnpayIpn);

module.exports = router;