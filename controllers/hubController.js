const Hub = require("../models/Hub");

module.exports = {
    createHub: async (req, res) => {
        try {
            const { name, code, type, latitude, longitude, address } = req.body;
            if (!name || !code || latitude == null || longitude == null) {
                return res.status(400).json({ status: false, message: "Thiếu thông tin hub" });
            }
            const exist = await Hub.findOne({ code });
            if (exist) return res.status(400).json({ status: false, message: "Mã hub đã tồn tại" });
            const hub = new Hub({ name, code, type: type || "local", latitude, longitude, address: address || "" });
            await hub.save();
            return res.status(201).json({ status: true, data: hub });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },
    listHubs: async (_req, res) => {
        try {
            const hubs = await Hub.find({ active: true }).lean();
            return res.status(200).json({ status: true, data: hubs });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },
    updateHub: async (req, res) => {
        try {
            const id = req.params.id;
            const payload = {};
            const allow = ["name", "address", "active", "latitude", "longitude", "type"];
            for (const k of allow) if (k in req.body) payload[k] = req.body[k];
            const hub = await Hub.findByIdAndUpdate(id, payload, { new: true });
            if (!hub) return res.status(404).json({ status: false, message: "Không tìm thấy hub" });
            return res.status(200).json({ status: true, data: hub });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    }
};
