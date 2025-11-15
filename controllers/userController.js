const User = require("../models/User");
const jwt = require("jsonwebtoken");
module.exports = {
  getUser: async (req, res) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy người dùng hoặc đã bị xóa",
        });
      }

      const { password, __v, otp, updatedAt, createdAt, ...userData } =
        user._doc;

      res.status(200).json(userData);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  verifyAccount: async (req, res) => {
    const userOtp = req.params.otp;

    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res
          .status(400)
          .json({ status: false, message: "Không tìm thấy người dùng" });
      }

      if (userOtp === user.otp) {
        user.verification = true;
        user.otp = "none";
        // clear expiration once user is verified
        user.expireAt = undefined;

        await user.save();

        const userToken = jwt.sign(
          {
            id: user._id,
            userType: user.userType,
            email: user.email,
          },
          process.env.JWT_SECRET,
          { expiresIn: "21d" }
        );

        const { password, __v, otp, createdAt, ...others } = user._doc;
        res.status(200).json({ ...others, userToken });
      } else {
        return res
          .status(400)
          .json({ status: false, message: "Xác thực OTP thất bại" });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  verifyPhone: async (req, res) => {
    const phone = req.params.phone;

    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res
          .status(400)
          .json({ status: false, message: "Không tìm thấy người dùng" });
      }

      user.phoneVerification = true;
      user.phone = phone;

      await user.save();

      const userToken = jwt.sign(
        {
          id: user._id,
          userType: user.userType,
          email: user.email,
        },
        process.env.JWT_SECRET,
        { expiresIn: "21d" }
      );

      const { password, __v, otp, createdAt, ...others } = user._doc;

      res.status(200).json({ ...others, userToken });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lưu FCM token
  updateFcmToken: async (req, res) => {
    const { fcmToken } = req.body;
    const userId = req.user.id;

    if (!fcmToken) {
      return res.status(400).json({
        status: false,
        message: "FCM token is required",
      });
    }

    try {
      await User.findByIdAndUpdate(userId, { fcm: fcmToken });

      res.status(200).json({
        status: true,
        message: "FCM token updated successfully",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xóa tài khoản
  deleteAccount: async (req, res) => {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        status: false,
        message: "Vui lòng nhập mật khẩu để xác nhận",
      });
    }

    try {
      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy người dùng",
        });
      }

      // Xác minh mật khẩu
      const CryptoJS = require("crypto-js");
      const decryptedPassword = CryptoJS.AES.decrypt(
        user.password,
        process.env.SECRET
      );
      const depassword = decryptedPassword.toString(CryptoJS.enc.Utf8);

      if (depassword !== password) {
        return res.status(400).json({
          status: false,
          message: "Mật khẩu không chính xác",
        });
      }

      // Xóa các dữ liệu liên quan
      const Cart = require("../models/Cart");
      const Favorite = require("../models/Favorite");
      const Address = require("../models/Address");

      await Cart.deleteMany({ userId });
      await Favorite.deleteMany({ userId });
      await Address.deleteMany({ userId });

      // Xóa user
      await User.findByIdAndDelete(userId);

      res.status(200).json({
        status: true,
        message: "Tài khoản đã được xóa thành công",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Kiểm tra trạng thái xác minh
  checkVerificationStatus: async (req, res) => {
    try {
      const user = await User.findById(req.user.id).select(
        "verification phoneVerification email phone"
      );

      if (!user) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy người dùng",
        });
      }

      res.status(200).json({
        status: true,
        emailVerified: user.verification,
        phoneVerified: user.phoneVerification,
        email: user.email,
        phone: user.phone || null,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
