const nodemailer = require('nodemailer');
async function sendEmail(userEmail,message) {

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.AUTH_EMAIL,
            pass: process.env.AUTH_PASSWORD,
        }
    });


    const mailOptions = {
        from: process.env.AUTH_EMAIL,
        to: userEmail,
        subject: 'Mã xác thực OTP của bạn',
        html: `<h1>Xác thực email </h1>
               <p>Mã xác thực của bạn là:</p>
               <h2 style="color: blue;">${message}</h2>
               <p>Vui lòng nhập mã này vào trang xác thực để hoàn tất quá trình đăng ký.</p>
               <p>Nếu bạn không yêu cầu điều này, vui lòng bỏ qua email này.</p>`

    };

    try {
        await transporter.sendMail(mailOptions);
        console.log("Email xác thực đã được gửi");
    } catch (error) {
        console.log("Gửi email thất bại với lỗi: ", error);
    }
}

module.exports = sendEmail;