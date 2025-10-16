const Store = require('../models/Store');

module.exports = {
    addStore: async (req, res) => {
        const { title, time, imageUrl, owner, code, logoUrl, coords } = req.body;
        if (!title || !time || !imageUrl || !owner || !code || !logoUrl || !coords
            || !coords.latitude || !coords.longitude || !coords.address || !coords.title) {
            return res.status(400).json({ status: false, message: "Bạn có một trường bị thiếu" });
        }
        try {
            const newStore = new Store(req.body);
            await newStore.save();
            res.status(201).json({ status: true, message: "Cửa hàng đã thêm thành công" });
        } catch (e) {
            res.status(500).json({ status: false, message: e.message });
        }
    },

    getStoreById: async (req, res) => {
        try {
            const store = await Store.findById(req.params.id);
            if (!store) return res.status(404).json({ status: false, message: "Không tìm thấy cửa hàng" });
            res.status(200).json(store);
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
    },

    getRandomStore: async (req, res) => {
        try {
            const code = req.params.code;
            let randomStore = [];

            if (code) {
                randomStore = await Store.aggregate([
                    { $match: { code: code, isAvailable: true } },
                    { $sample: { size: 5 } },
                    { $project: { __v: 0 } }
                ]);
            }

            if (randomStore.length === 0) {
                randomStore = await Store.aggregate([
                    { $match: { isAvailable: true } },
                    { $sample: { size: 5 } },
                    { $project: { __v: 0 } }
                ]);
            }

            res.status(200).json(randomStore);
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
    },

    getAllNearByStore: async (req, res) => {
        try {
            const code = req.params.code;
            let allNearByStores = [];

            if (code) {
                allNearByStores = await Store.aggregate([
                    { $match: { code: code, isAvailable: true } },
                    { $project: { __v: 0 } }
                ]);
            }

            if (allNearByStores.length === 0) {
                allNearByStores = await Store.aggregate([
                    { $match: { isAvailable: true } },
                    { $project: { __v: 0 } }
                ]);
            }

            res.status(200).json(allNearByStores);
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
    }
};
