const router = require("express").Router();
const { verifyToken, verifyAdmin } = require("../middleware/verifyToken");
const controller = require("../controllers/serviceTicketController");

router.post("/tickets", verifyToken, controller.createTicket);
router.get("/tickets", verifyToken, controller.listMyTickets);
router.get("/tickets/:id", verifyToken, controller.getTicketById);
router.post("/tickets/:id/reply", verifyToken, controller.replyTicket);
router.get("/meta/options", verifyToken, controller.getTicketOptions);

router.get("/admin/tickets", verifyAdmin, controller.adminListTickets);
router.get("/admin/tickets/:id", verifyAdmin, controller.getTicketById);
router.patch("/admin/tickets/:id", verifyAdmin, controller.adminUpdateTicket);
router.post("/admin/tickets/:id/reply", verifyAdmin, controller.replyTicket);

module.exports = router;
