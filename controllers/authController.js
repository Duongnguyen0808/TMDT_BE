const User = require("../models/User");
const jwt = require("jsonwebtoken");
const passwordService = require("../utils/passwordService");
const generateOtp = require("../utils/otp_generator");
const sendMail = require("../utils/smtp_function");
const sendSmsOtp = require("../utils/sms_function");

module.exports = {
  createUser: async (req, res) => {
    // Đảm bảo email đúng định dạng cơ bản trước khi tạo user
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
      // Ngăn đăng ký trùng email
      const emailExists = await User.findOne({ email: req.body.email });

      if (emailExists) {
        return res
          .status(400)
          .json({ status: false, message: res.__("auth.email_exists") });
      }

      // Tạo OTP để gửi email xác minh, đồng thời set expireAt để xoá user nếu không verify
      const otp = generateOtp();

      const hashedPassword = await passwordService.hashPassword(
        req.body.password
      );

      const newUser = new User({
        username: req.body.username,
        email: req.body.email,
        userType: "Client",
        password: hashedPassword,
        passwordVersion: 2,
        passwordMigratedAt: new Date(),
        otp: otp,
        // auto-delete after 10 minutes if not verified
        expireAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      // Lưu tạm user chưa verify vào DB
      await newUser.save();

      // Gửi OTP qua SMTP nội bộ, client sẽ nhập lại để kích hoạt
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
    const hashedPassword = await passwordService.hashPassword("admin123");
    const newUser = new User({
      username: "Admin",
      email: "admin@tmdt.com",
      password: hashedPassword,
      passwordVersion: 2,
      passwordMigratedAt: new Date(),
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
    try {
      // Chuẩn hoá email để tránh trùng giữa hoa/thường
      const emailRaw = String(req.body.email || '').trim().toLowerCase();
      const passwordRaw = String(req.body.password || '');
      const fcmToken = req.body.fcmToken;

      const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(emailRaw)) {
        return res.status(400).json({ status: false, code: 'INVALID_EMAIL', message: 'Email không hợp lệ' });
      }

      const minPasswordLength = 6; // Chấp nhận tối thiểu 6 nếu đăng ký công khai ban đầu
      if (passwordRaw.length < minPasswordLength) {
        return res.status(400).json({ status: false, code: 'PASSWORD_TOO_SHORT', message: `Mật khẩu phải >= ${minPasswordLength} ký tự` });
      }

      const user = await User.findOne({ email: emailRaw });
      if (!user) {
        return res.status(400).json({ status: false, code: 'USER_NOT_FOUND', message: 'Không tìm thấy tài khoản' });
      }

      const passwordMatches = await passwordService.verifyUserPassword(user, passwordRaw);
      if (!passwordMatches) {
        return res.status(400).json({ status: false, code: 'WRONG_PASSWORD', message: 'Sai mật khẩu' });
      }

      // Không chặn đăng nhập nếu chưa verify để họ có thể tiếp tục nhận OTP bên trong app
      if (!user.verification && user.userType !== 'Driver') {
        // Có thể yêu cầu xác minh nhưng vẫn cho login để họ hoàn tất OTP
      }

      // Lưu token FCM mới nhất để backend có thể push thông báo chính xác cho thiết bị
      if (fcmToken && typeof fcmToken === 'string' && fcmToken.length > 20) {
        try { await User.findByIdAndUpdate(user._id, { fcm: fcmToken }); } catch (_) { }
      }

      const jwtSecret = (process.env.JWT_SECRET || '').trim();
      if (!jwtSecret) {
        return res.status(500).json({ status: false, code: 'JWT_SECRET_MISSING', message: 'Thiếu JWT_SECRET trên server' });
      }

      // JWT chứa id + userType để client gửi kèm trong header cho các API yêu cầu quyền
      const userToken = jwt.sign({ id: user._id, userType: user.userType, email: user.email }, jwtSecret, { expiresIn: '21d' });
      const { password, createdAt, updatedAt, __v, otp, ...others } = user._doc;
      return res.status(200).json({ status: true, code: 'LOGIN_OK', data: others, userToken });
    } catch (error) {
      console.error('[loginUser][ERROR]', error);
      return res.status(500).json({ status: false, code: 'SERVER_ERROR', message: error.message });
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
        // Ưu tiên gửi email nếu cung cấp email
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

      user.password = await passwordService.hashPassword(newPassword);
      user.passwordVersion = 2;
      user.passwordMigratedAt = new Date();
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

      const currentPasswordOk = await passwordService.verifyUserPassword(
        user,
        oldPassword,
        { upgradeOnMatch: false }
      );

      if (!currentPasswordOk) {
        return res
          .status(400)
          .json({ status: false, message: "Mật khẩu hiện tại không đúng" });
      }

      user.password = await passwordService.hashPassword(newPassword);
      user.passwordVersion = 2;
      user.passwordMigratedAt = new Date();
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
      // Không cho phép hai tài khoản cùng xác minh chung một số
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

      // Lưu OTP cùng số vừa nhập để verify ở bước sau
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

      // Đặt cờ phoneVerification để tránh phải verify lại
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
