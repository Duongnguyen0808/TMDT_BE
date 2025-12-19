const router = require('express').Router();
const { createVnpayPayment, vnpayReturn, vnpayIpn } = require('../controllers/paymentController');

// VNPay browser return callback
router.get('/vnpay/vnpay_return', vnpayReturn);

// VNPay IPN (server-to-server)
router.get('/vnpay/vnpay_ipn', vnpayIpn);

// VNPay create payment URL
router.post('/vnpay/create', createVnpayPayment);

module.exports = router;