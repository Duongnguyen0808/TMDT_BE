const router = require('express').Router();
const { registerToken, deleteToken, getTokenInfo } = require('../controllers/fcmController');

router.post('/register', registerToken);
router.post('/delete', deleteToken);
router.get('/my-token', getTokenInfo);

module.exports = router;
