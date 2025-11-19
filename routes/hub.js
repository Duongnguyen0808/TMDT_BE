const router = require("express").Router();
const { verifyAdmin } = require("../middleware/verifyToken");
const hubController = require("../controllers/hubController");

router.post("/", verifyAdmin, hubController.createHub);
router.get("/", verifyAdmin, hubController.listHubs);
router.patch("/:id", verifyAdmin, hubController.updateHub);

module.exports = router;
