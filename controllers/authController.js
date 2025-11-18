const User = require("../models/User");
const CryptoJS = require("crypto-js");
const jwt = require("jsonwebtoken");
const generateOtp = require("../utils/otp_generator");
const sendMail = require("../utils/smtp_function");
const sendSmsOtp = require("../utils/sms_function");

module.exports = {
  createUser: async (req, res) => {
    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;

    if (!emailRegex.test(req.body.email)) {
      return res
        .status(400)
        .json({ status: false, message: "Email is not valid" });
    }

    const minPasswordLength = 8;

    if (req.body.password.length < minPasswordLength) {
      return res.status(400).json({
        status: false,
        message: res.__("auth.password_min_length"),
      });
    }

    try {
      const emailExists = await User.findOne({ email: req.body.email });

      if (emailExists) {
        return res
          .status(400)
          .json({ status: false, message: res.__("auth.email_exists") });
      }

      // GENERATE OTP
      const otp = generateOtp();

      const newUser = new User({
        username: req.body.username,
        email: req.body.email,
        userType: "Client",
        password: CryptoJS.AES.encrypt(
          req.body.password,
          process.env.SECRET
        ).toString(),
        otp: otp,
        // auto-delete after 10 minutes if not verified
        expireAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      // SAVE USER
      await newUser.save();

      // SEND OTP TO EMAIL
      sendMail(newUser.email, otp);

      res
        .status(201)
        .json({ status: true, message: res.__("auth.register_success") });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Tạo tài khoản Admin (chỉ dùng lần đầu)
  createAdmin: async (req, res) => {
    const newUser = new User({
      username: "Admin",
      email: "admin@tmdt.com",
      password: CryptoJS.AES.encrypt("admin123", process.env.SECRET).toString(),
      userType: "Admin",
      verification: true,
      phoneVerification: true,
      phone: "0123456789",
      profile:
        "https://ui-avatars.com/api/?name=Admin&background=1e3c72&color=fff",
    });

    try {
      await newUser.save();
      res.status(201).json({
        status: true,
        message:
          "Tạo Admin thành công! Email: admin@tmdt.com, Mật khẩu: admin123",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  loginUser: async (req, res) => {
    const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;

    if (!emailRegex.test(req.body.email)) {
      return res
        .status(400)
        .json({ status: false, message: "Email không hợp lệ" });
    }

    const minPasswordLength = 8;

    if (req.body.password < minPasswordLength) {
      return res.status(400).json({
        status: false,
        message: "Mật khẩu phải có ít nhất " + minPasswordLength + " ký tự",
      });
    }

    try {
      const user = await User.findOne({ email: req.body.email });

      if (!user) {
        return res
          .status(400)
          .json({ status: false, message: res.__("user.user_not_found") });
      }

      const decryptedPassword = CryptoJS.AES.decrypt(
        user.password,
        process.env.SECRET
      );
      const depassword = decryptedPassword.toString(CryptoJS.enc.Utf8);

      if (depassword !== req.body.password) {
        return res
          .status(400)
          .json({ status: false, message: res.__("auth.login_failed") });
      }

      // Optional: update FCM token if provided on login
      if (req.body.fcmToken && typeof req.body.fcmToken === 'string' && req.body.fcmToken.length > 20) {
        try {
          await User.findByIdAndUpdate(user._id, { fcm: req.body.fcmToken });
        } catch (_) { }
      }

      const userToken = jwt.sign(
        {
          id: user._id,
          userType: user.userType,
          email: user.email,
        },
        process.env.JWT_SECRET,
        { expiresIn: "21d" }
      );

      const { password, createdAt, updatedAt, __v, otp, ...others } = user._doc;

      res.status(200).json({ ...others, userToken });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Forgot password (send OTP via email or phone)
  forgotPassword: async (req, res) => {
    try {
      const { email, phone } = req.body;

      if (!email && !phone) {
        return res
          .status(400)
          .json({ status: false, message: "Vui lòng cung cấp email hoặc số điện thoại" });
      }

      let user;
      if (email) {
        user = await User.findOne({ email });
      } else if (phone) {
        user = await User.findOne({ phone });
      }

      if (!user) {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy người dùng" });
      }

      const otp = generateOtp();
      user.resetPasswordOTP = otp;
      user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 phút
      await user.save();

      if (email) {
        await sendMail(user.email, otp);
      } else if (phone) {
        // chuẩn hoá +84
        let phoneFormatted = phone;
        if (phone.startsWith("0")) {
          phoneFormatted = "+84" + phone.substring(1);
        } else if (!phone.startsWith("+")) {
          phoneFormatted = "+84" + phone;
        }
        await sendSmsOtp(phoneFormatted, otp);
      }

      return res.status(200).json({
        status: true,
        message: "Mã OTP đặt lại mật khẩu đã được gửi",
      });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  // Reset password using OTP
  resetPassword: async (req, res) => {
    try {
      const { email, phone, otp, newPassword } = req.body;

      if ((!email && !phone) || !otp || !newPassword) {
        return res.status(400).json({
          status: false,
          message: "Thiếu thông tin: email/phone, otp, newPassword",
        });
      }

      if (newPassword.length < 8) {
        return res
          .status(400)
          .json({ status: false, message: "Mật khẩu phải có ít nhất 8 ký tự" });
      }

      let user;
      if (email) {
        user = await User.findOne({ email });
      } else if (phone) {
        user = await User.findOne({ phone });
      }

      if (!user) {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy người dùng" });
      }

      if (!user.resetPasswordOTP || !user.resetPasswordExpires) {
        return res.status(400).json({
          status: false,
          message: "Vui lòng yêu cầu OTP đặt lại mật khẩu trước",
        });
      }

      if (new Date() > new Date(user.resetPasswordExpires)) {
        return res
          .status(400)
          .json({ status: false, message: "OTP đã hết hạn" });
      }

      if (user.resetPasswordOTP !== otp) {
        return res
          .status(400)
          .json({ status: false, message: "OTP không chính xác" });
      }

      // Update password
      user.password = CryptoJS.AES.encrypt(
        newPassword,
        process.env.SECRET
      ).toString();
      user.resetPasswordOTP = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      return res.status(200).json({
        status: true,
        message: "Đặt lại mật khẩu thành công",
      });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  // Change password for authenticated user
  changePassword: async (req, res) => {
    try {
      const userId = req.user.id;
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        return res
          .status(400)
          .json({ status: false, message: "Thiếu thông tin mật khẩu" });
      }

      if (newPassword.length < 8) {
        return res
          .status(400)
          .json({ status: false, message: "Mật khẩu phải có ít nhất 8 ký tự" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy người dùng" });
      }

      const decrypted = CryptoJS.AES.decrypt(user.password, process.env.SECRET);
      const currentPassword = decrypted.toString(CryptoJS.enc.Utf8);

      if (currentPassword !== oldPassword) {
        return res
          .status(400)
          .json({ status: false, message: "Mật khẩu hiện tại không đúng" });
      }

      user.password = CryptoJS.AES.encrypt(
        newPassword,
        process.env.SECRET
      ).toString();
      await user.save();

      return res
        .status(200)
        .json({ status: true, message: "Đổi mật khẩu thành công" });
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message });
    }
  },

  // Gửi OTP qua SMS để xác minh số điện thoại
  sendPhoneOtp: async (req, res) => {
    const { phone } = req.body;
    const userId = req.user.id; // Từ JWT token

    if (!phone || phone.length < 10) {
      return res
        .status(400)
        .json({ status: false, message: "Số điện thoại không hợp lệ" });
    }

    try {
      // Kiểm tra số điện thoại đã được sử dụng chưa
      const phoneExists = await User.findOne({
        phone: phone,
        phoneVerification: true,
        _id: { $ne: userId },
      });

      if (phoneExists) {
        return res
          .status(400)
          .json({ status: false, message: "Số điện thoại đã được sử dụng" });
      }

      // Tạo OTP
      const otp = generateOtp();

      // Cập nhật OTP và số điện thoại
      await User.findByIdAndUpdate(userId, {
        phone: phone,
        otp: otp,
      });

      // Gửi OTP qua SMS (định dạng quốc tế: +84)
      let phoneFormatted = phone;
      if (phone.startsWith("0")) {
        phoneFormatted = "+84" + phone.substring(1);
      } else if (!phone.startsWith("+")) {
        phoneFormatted = "+84" + phone;
      }

      const smsResult = await sendSmsOtp(phoneFormatted, otp);

      if (smsResult.success) {
        res.status(200).json({
          status: true,
          message: "OTP đã được gửi đến số điện thoại của bạn",
        });
      } else {
        res.status(500).json({
          status: false,
          message: "Không thể gửi OTP. Vui lòng thử lại sau.",
        });
      }
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Xác minh OTP số điện thoại
  verifyPhoneOtp: async (req, res) => {
    const { otp } = req.body;
    const userId = req.user.id;

    try {
      const user = await User.findById(userId);

      if (!user) {
        return res
          .status(404)
          .json({ status: false, message: "Không tìm thấy người dùng" });
      }

      if (user.otp !== otp) {
        return res
          .status(400)
          .json({ status: false, message: "OTP không chính xác" });
      }

      // Xác minh thành công
      user.phoneVerification = true;
      user.otp = "none";
      await user.save();

      res.status(200).json({
        status: true,
        message: "Xác minh số điện thoại thành công",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
