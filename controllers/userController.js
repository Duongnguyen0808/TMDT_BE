const User = require('../models/User');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken');
const generateOtp = require('../utils/otp_generator');
const sendMail = require("../utils/smtp_function");

module.exports = {
  // ✅ Tạo user
  createUser: async (req, res) => {
    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;

    if (!emailRegex.test(req.body.email)) {
      return res.status(400).json({ status: false, message: "Email is not valid" });
    }

    const minPasswordLength = 8;
    if (req.body.password.length < minPasswordLength) {
      return res.status(400).json({
        status: false,
        message: "Password should be at least " + minPasswordLength + " characters long"
      });
    }

    try {
      const emailExists = await User.findOne({ email: req.body.email });
      if (emailExists) {
        return res.status(400).json({ status: false, message: "Email already exists" });
      }

      const otp = generateOtp();

      const newUser = new User({
        username: req.body.username,
        email: req.body.email,
        userType: "Client",
        password: CryptoJS.AES.encrypt(req.body.password, process.env.SECRET).toString(),
        otp: otp
      });

      await newUser.save();
      sendMail(newUser.email, otp);

      res.status(201).json({ status: true, message: "User successfully created." });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ✅ Login user
  loginUser: async (req, res) => {
    try {
      const user = await User.findOne({ email: req.body.email });
      if (!user) {
        return res.status(400).json({ status: false, message: "User not found" });
      }

      const decryptedPassword = CryptoJS.AES.decrypt(user.password, process.env.SECRET);
      const depassword = decryptedPassword.toString(CryptoJS.enc.Utf8);

      if (depassword !== req.body.password) {
        return res.status(400).json({ status: false, message: "Wrong Password" });
      }

      // ✅ Thêm id đúng chuẩn
      const userToken = jwt.sign(
        {
          id: user._id.toString(),
          userType: user.userType,
          email: user.email,
        },
        process.env.JWT_SECRET,
        { expiresIn: "21d" }
      );

      const { password, otp, ...others } = user._doc;
      res.status(200).json({ ...others, userToken });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ✅ Get user info
  getUser: async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ status: false, message: "User not found" });
      }

      const { password, otp, __v, createdAt, ...others } = user._doc;
      res.status(200).json({ status: true, ...others });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ✅ Verify OTP
  verifyAccount: async (req, res) => {
    const userOtp = req.params.otp;
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(400).json({ status: false, message: "User not found" });
      }

      if (userOtp === user.otp) {
        user.verification = true;
        user.otp = "none";
        await user.save();

        const { password, __v, otp, createdAt, ...others } = user._doc;
        return res.status(200).json({ ...others });
      } else {
        return res.status(400).json({ status: false, message: "Invalid OTP" });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ✅ Verify phone
  verifyPhone: async (req, res) => {
    const phone = req.params.phone;
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(400).json({ status: false, message: "User not found" });
      }

      user.phoneVerification = true;
      user.phone = phone;
      await user.save();

      const { password, __v, otp, createdAt, ...others } = user._doc;
      return res.status(200).json({ ...others });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ✅ Delete user
  deleteUser: async (req, res) => {
    try {
      await User.findByIdAndDelete(req.user.id);
      res.status(200).json({ status: true, message: "User deleted successfully" });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
