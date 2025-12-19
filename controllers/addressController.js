const mongoose = require("mongoose");
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
      if (req.body.default === true) {
        await Address.updateMany({ userId: req.user.id }, { default: false });
      }
      const saved = await newAddress.save();
      res.status(201).json({
        status: true,
        message: "Thêm địa chỉ thành công",
        address: saved,
      });
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
  updateAddress: async (req, res) => {
    const userId = req.user.id;
    const addressId = req.params.id;

    const updatableFields = [
      "addressLine1",
      "deliveryInstructions",
      "latitude",
      "longitude",
      "displayName",
      "refId",
      "default",
    ];
    const payload = {};

    for (const field of updatableFields) {
      if (typeof req.body[field] !== "undefined") {
        payload[field] = req.body[field];
      }
    }

    if (Object.keys(payload).length === 0) {
      return res
        .status(400)
        .json({ status: false, message: "Không có dữ liệu để cập nhật" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const address = await Address.findOne({ _id: addressId, userId }).session(
        session
      );

      if (!address) {
        await session.abortTransaction();
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy địa chỉ" });
      }

      if (payload.default === true) {
        await Address.updateMany({ userId }, { default: false }).session(
          session
        );
      }

      payload.lastUsedAt = new Date();

      const updated = await Address.findByIdAndUpdate(addressId, payload, {
        new: true,
        session,
      });

      if (payload.default === true) {
        await User.findByIdAndUpdate(userId, { address: addressId }).session(
          session
        );
      }

      await session.commitTransaction();

      return res.status(200).json({
        status: true,
        message: "Cập nhật địa chỉ thành công",
        address: updated,
      });
    } catch (error) {
      await session.abortTransaction();
      return res.status(500).json({ status: false, message: error.message });
    } finally {
      session.endSession();
    }
  },
  deleteAddress: async (req, res) => {
    try {
      await Address.findByIdAndDelete(req.params.id);
      res.status(200).json({ status: true, message: "Xóa địa chỉ thành công" });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
  setAddressDdefault: async (req, res) => {
    const addressId = req.params.id;
    const userId = req.user.id;
    try {
      await Address.updateMany({ userId: userId }, { default: false });
      const updateAddress = await Address.findByIdAndUpdate(
        addressId,
        { default: true, lastUsedAt: new Date() },
        { new: true }
      );
      if (updateAddress) {
        await Address.findByIdAndUpdate(addressId, { $inc: { usageCount: 1 } });
        await User.findByIdAndUpdate(userId, { address: addressId });
        res.status(200).json({
          status: true,
          message: "Đặt làm địa chỉ mặc định thành công",
        });
      } else {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy địa chỉ" });
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
      if (!addr)
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy địa chỉ" });
      res.status(200).json({ status: true, address: addr });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
  getDefaultAddress: async (req, res) => {
    const userId = req.user.id;
    try {
      const address = await Address.findOne({ userId: userId, default: true });
      res.status(200).json({ address });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
