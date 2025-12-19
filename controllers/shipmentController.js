const Shipment = require("../models/Shipment");
const Order = require("../models/Order");

const statusFlow = [
    "Creating",
    "Consolidating",
    "DepartOrigin",
    "ArriveOrigin",
    "DepartLocal",
    "ArriveLocal",
    "ReadyPickup",
    "Completed"
];

module.exports = {
    createShipment: async (req, res) => {
        try {
            const { code, orderIds = [], originHub, localHub } = req.body;
            if (!code) return res.status(400).json({ status: false, message: "Thiếu code" });
            const exist = await Shipment.findOne({ code });
            if (exist) return res.status(400).json({ status: false, message: "Code đã tồn tại" });
            const shipment = new Shipment({ code, orders: orderIds, originHub, localHub, status: "Creating" });
            await shipment.save();
            return res.status(201).json({ status: true, data: shipment });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },
    listShipments: async (_req, res) => {
        try {
            const data = await Shipment.find().populate("originHub localHub orders").lean();
            return res.status(200).json({ status: true, data });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },
    advanceShipment: async (req, res) => {
        try {
            const id = req.params.id;
            const shipment = await Shipment.findById(id);
            if (!shipment) return res.status(404).json({ status: false, message: "Không tìm thấy shipment" });
            const currentIdx = statusFlow.indexOf(shipment.status);
            if (currentIdx === -1 || currentIdx === statusFlow.length - 1) {
                return res.status(400).json({ status: false, message: "Không thể tiến thêm" });
            }
            const nextStatus = statusFlow[currentIdx + 1];
            shipment.status = nextStatus;
            shipment.timeline[`${nextStatus}At`] = new Date();
            await shipment.save();
            // reflect to orders logisticStatus at certain milestones
            let targetLogistics = null;
            switch (nextStatus) {
                case "DepartOrigin": targetLogistics = "ToOriginHub"; break;
                case "ArriveOrigin": targetLogistics = "AtOriginHub"; break;
                case "DepartLocal": targetLogistics = "ToLocalHub"; break;
                case "ArriveLocal": targetLogistics = "AtLocalHub"; break;
                case "ReadyPickup": targetLogistics = "AtLocalHub"; break; // readiness stays same
                case "Completed": targetLogistics = "Delivered"; break;
            }
            if (targetLogistics) {
                await Order.updateMany({ _id: { $in: shipment.orders } }, { $set: { logisticStatus: targetLogistics } });
            }
            try {
                const io = req.app.get("io");
                if (io) io.emit("shipment:updated", { shipmentId: String(shipment._id), status: shipment.status });
            } catch (_) { }
            return res.status(200).json({ status: true, data: shipment });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    }
};
