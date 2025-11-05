const User = require("../models/User");
const Address = require("../models/Address");

module.exports = {
    addAddress: async (req, res) => { 

        const newAddress = new Address({
            userId: req.user.id,
            addressLine1: req.body.addressLine1,
            default: req.body.default,
            deliveryInstructions: req.body.deliveryInstructions,
            latitude: req.body.latitude,
            longitude: req.body.longitude,
            displayName: req.body.displayName,
            refId: req.body.refId,
            usageCount: 1,
            lastUsedAt: new Date(),
        });

        try {
             if(req.body.default === true){
                await Address.updateMany({ userId: req.user.id },  { default: false });
             }
             const saved = await newAddress.save();
             res.status(201).json({ status: true, message: "Address added successfully.", address: saved });
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
},
    getAddress: async (req, res) => {
    try {
      const addresses = await Address.find({ userId: req.user.id });
      res.status(200).json({ addresses });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
    getRecentAddresses: async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 5;
            const addresses = await Address.find({ userId: req.user.id })
                .sort({ lastUsedAt: -1, updatedAt: -1 })
                .limit(limit);
            res.status(200).json({ addresses });
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
    },
    deleteAddress: async (req, res) => {
        try {
            await Address.findByIdAndDelete(req.params.id);
            res.status(200).json({ status: true, message: "Address deleted successfully." });
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
},
    setAddressDdefault: async (req, res) => {
        const addressId = req.params.id;
        const userId = req.user.id;
        try {
            await Address.updateMany({ userId: userId},  { default: false });
            const updateAddress = await Address.findByIdAndUpdate(addressId, { default: true, lastUsedAt: new Date() }, { new: true });
            if (updateAddress) {
                await Address.findByIdAndUpdate(addressId, { $inc: { usageCount: 1 } });
                await User.findByIdAndUpdate(userId, { address: addressId});
                res.status(200).json({ status: true, message: "Address set as default successfully." });
            }else{
                return res.status(404).json({ status: false, message: "Address not found." });
            }
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
},
    useAddress: async (req, res) => {
        const addressId = req.params.id;
        const userId = req.user.id;
        try {
            const addr = await Address.findOneAndUpdate(
                { _id: addressId, userId: userId },
                { $inc: { usageCount: 1 }, lastUsedAt: new Date() },
                { new: true }
            );
            if (!addr) return res.status(404).json({ status: false, message: "Address not found." });
            res.status(200).json({ status: true, address: addr });
        } catch (error) {
            res.status(500).json({ status: false, message: error.message });
        }
    },
    getDefaultAddress: async (req, res) => {
        const userId = req.user.id;
        try {
            const address = await Address.findOne({ userId: userId, default: true });
            res.status(200).json({address});
        } catch (error) {
            res.status(500).json({status: false, message: error.message });
        }
}
}