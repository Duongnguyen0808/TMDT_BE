// SMS OTP Function using Twilio (Free Trial)
// Để sử dụng: npm install twilio
// Đăng ký tài khoản miễn phí tại: https://www.twilio.com/try-twilio

const twilio = require("twilio");

// Cấu hình Twilio từ .env
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

let client;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
}

/**
 * Gửi OTP qua SMS
 * @param {string} phoneNumber - Số điện thoại (định dạng quốc tế: +84xxxxxxxxx)
 * @param {string} otp - Mã OTP
 * @returns {Promise<Object>} - Kết quả gửi SMS
 */
const sendSmsOtp = async (phoneNumber, otp) => {
  try {
    // Kiểm tra cấu hình Twilio
    if (!client) {
      console.log("⚠️  Twilio chưa được cấu hình. OTP sẽ được in ra console.");
      console.log(`📱 OTP cho số ${phoneNumber}: ${otp}`);
      return {
        success: true,
        message: "OTP sent (console mode)",
        otp: otp, // CHỈ cho môi trường development
      };
    }

    // Gửi SMS qua Twilio
    const message = await client.messages.create({
      body: `Mã xác thực của bạn là: ${otp}. Mã có hiệu lực trong 10 phút.`,
      from: twilioPhoneNumber,
      to: phoneNumber,
    });

    console.log(`✅ SMS đã gửi đến ${phoneNumber}. SID: ${message.sid}`);

    return {
      success: true,
      message: "OTP sent successfully",
      sid: message.sid,
    };
  } catch (error) {
    console.error("❌ Lỗi gửi SMS:", error.message);

    // Fallback: In OTP ra console khi lỗi (chỉ development)
    if (process.env.NODE_ENV !== "production") {
      console.log(`📱 [FALLBACK] OTP cho số ${phoneNumber}: ${otp}`);
      return {
        success: true,
        message: "OTP sent (console fallback)",
        otp: otp,
      };
    }

    return {
      success: false,
      message: error.message,
    };
  }
};

module.exports = sendSmsOtp;
