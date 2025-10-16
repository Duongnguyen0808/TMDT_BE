const router = require('express').Router();
const storeController = require('../controllers/storeController');
const {verifyTokenAndAuthorization} = require('../middleware/verifyToken');

router.post("/",verifyTokenAndAuthorization,storeController.addStore);

router.get("/:code",storeController.getRandomStore);

router.get("/all/:code",storeController.getAllNearByStore);

router.get("/byId/:id",storeController.getStoreById);
module.exports = router;