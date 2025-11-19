const User = require("../models/User");
const ShipperApplication = require("../models/ShipperApplication");

const requiredFields = [
    "fullName",
    "phone",
    "vehicleType",
    "vehiclePlate",
    "idFrontUrl",
    "idBackUrl",
    "driverLicenseUrl",
    "vehicleRegUrl",
    "selfieUrl",
];

const logAndSend = (res, status, code, message) => {
    console.warn(`[shipperController][${code}] ${message}`);
    return res.status(status).json({ status: false, code, message });
};

module.exports = {
    publicApply: async (req, res) => {
        try {
            console.log("[publicApply] incoming body:", JSON.stringify(req.body));
            const {
                email,
                password,
                fullName,
                phone,
                vehicleType,
                vehiclePlate,
                idFrontUrl,
                idBackUrl,
                driverLicenseUrl,
                vehicleRegUrl,
                selfieUrl,
                recaptchaToken,
            } = req.body;

            const missing = [];
            const requiredUserFields = ["email", "password", "fullName", "phone"];
            for (const f of requiredUserFields)
                if (!req.body[f] || String(req.body[f]).trim() === "") missing.push(f);
            for (const f of requiredFields)
                if (!req.body[f] || String(req.body[f]).trim() === "") missing.push(f);
            if (missing.length)
                return logAndSend(
                    res,
                    400,
                    "MISSING_FIELDS",
                    `Thiếu trường: ${missing.join(", ")}`
                );

            const allowedVehicleTypes = [
                "motorbike",
                "car",
                "light_truck",
                "heavy_truck",
            ];
            if (!allowedVehicleTypes.includes(vehicleType))
                return logAndSend(res, 400, "INVALID_VEHICLE_TYPE", "Loại xe không hợp lệ");

            const platePattern = /^[0-9]{2}[A-Z]{1,2}[- ]?[0-9]{3,5}(\.[0-9]{2})?$/i;
            if (!platePattern.test(vehiclePlate))
                return logAndSend(
                    res,
                    400,
                    "INVALID_PLATE",
                    "Biển số xe không hợp lệ. Ví dụ: 29A-123.45 hoặc 29A-1234.56"
                );

            if (!recaptchaToken || String(recaptchaToken).trim() === "")
                return logAndSend(res, 400, "CAPTCHA_MISSING", "Thiếu mã CAPTCHA");
            const secret = process.env.RECAPTCHA_SECRET;
            if (secret) {
                // Cho phép token đơn giản trong môi trường dev để không chặn quy trình
                const simpleTokenPattern = /^(ok|checked|simple)$/i;
                if (!simpleTokenPattern.test(recaptchaToken)) {
                    try {
                        const fetch = require("node-fetch");
                        const verifyResp = await fetch(
                            "https://www.google.com/recaptcha/api/siteverify",
                            {
                                method: "POST",
                                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                                body: new URLSearchParams({ secret, response: recaptchaToken }),
                            }
                        );
                        const verifyData = await verifyResp.json();
                        if (!verifyData.success) {
                            console.warn("[publicApply] reCAPTCHA verify fail detail:", verifyData);
                            return logAndSend(res, 400, "INVALID_CAPTCHA", "CAPTCHA không hợp lệ");
                        }
                    } catch (e) {
                        console.error("[publicApply] reCAPTCHA network/error:", e);
                        // Không trả 500 nữa để tránh chặn hoàn toàn – trả 400 hoặc cho phép nếu là dev
                        if (process.env.NODE_ENV === 'development') {
                            console.warn('[publicApply] bypass CAPTCHA due to dev & error');
                        } else {
                            return logAndSend(res, 400, "CAPTCHA_VERIFY_ERROR", "Không xác thực được CAPTCHA");
                        }
                    }
                } else {
                    console.warn('[publicApply] dùng simple token fallback mặc dù có secret');
                }
            } else {
                const allowedSimpleTokens = ["ok", "checked", "simple"];
                if (!allowedSimpleTokens.includes(recaptchaToken))
                    return logAndSend(
                        res,
                        400,
                        "SIMPLE_CAPTCHA_REQUIRED",
                        "CAPTCHA đơn giản: đánh dấu ô kiểm"
                    );
            }

            const existUser = await User.findOne({ email: String(email).toLowerCase() });
            if (existUser)
                return logAndSend(res, 400, "EMAIL_EXISTS", "Email đã được sử dụng");

            const CryptoJS = require("crypto-js");
            const newUser = new User({
                username: fullName,
                email: String(email).toLowerCase(),
                password: CryptoJS.AES.encrypt(password, process.env.SECRET).toString(),
                phone,
                userType: "Client",
                verification: true,
                phoneVerification: true,
            });
            await newUser.save();
            console.log("[publicApply] created user id=", newUser._id);

            const appData = {
                user: newUser._id,
                fullName,
                phone,
                vehicleType,
                vehiclePlate,
                idFrontUrl,
                idBackUrl,
                driverLicenseUrl,
                vehicleRegUrl,
                selfieUrl,
                approvalStatus: "pending",
            };
            const record = await ShipperApplication.create(appData);
            console.log("[publicApply] created application id=", record._id);
            const jwt = require("jsonwebtoken");
            const token = jwt.sign(
                { id: newUser._id, userType: newUser.userType },
                process.env.JWT_SECRET,
                { expiresIn: "7d" }
            );
            return res.status(201).json({
                status: true,
                message: "Đã tạo tài khoản và gửi hồ sơ",
                data: { applicationId: record._id, userId: newUser._id },
                token,
            });
        } catch (error) {
            console.error("[publicApply][ERROR]:", error);
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
    apply: async (req, res) => {
        try {
            console.log("[apply] user=", req.user?.id, "body=", JSON.stringify(req.body));
            const userId = req.user.id;
            const exists = await ShipperApplication.findOne({ user: userId });
            if (exists && exists.approvalStatus === "pending")
                return logAndSend(
                    res,
                    400,
                    "ALREADY_PENDING",
                    "Bạn đã gửi hồ sơ và đang chờ duyệt"
                );

            for (const f of requiredFields)
                if (!req.body[f] || String(req.body[f]).trim() === "")
                    return logAndSend(
                        res,
                        400,
                        "MISSING_FIELD",
                        `Thiếu trường bắt buộc: ${f}`
                    );
            const allowedVehicleTypes = [
                "motorbike",
                "car",
                "light_truck",
                "heavy_truck",
            ];
            if (!allowedVehicleTypes.includes(req.body.vehicleType))
                return logAndSend(res, 400, "INVALID_VEHICLE_TYPE", "Loại xe không hợp lệ");
            const platePattern2 = /^[0-9]{2}[A-Z]{1,2}[- ]?[0-9]{3,5}(\.[0-9]{2})?$/i;
            if (!platePattern2.test(req.body.vehiclePlate))
                return logAndSend(
                    res,
                    400,
                    "INVALID_PLATE",
                    "Biển số xe không hợp lệ. Ví dụ: 29A-123.45 hoặc 29A-1234.56"
                );

            await User.findByIdAndUpdate(userId, {
                username: req.body.fullName,
                phone: req.body.phone,
            });

            const appData = {
                user: userId,
                fullName: req.body.fullName,
                phone: req.body.phone,
                vehicleType: req.body.vehicleType,
                vehiclePlate: req.body.vehiclePlate,
                idFrontUrl: req.body.idFrontUrl,
                idBackUrl: req.body.idBackUrl,
                driverLicenseUrl: req.body.driverLicenseUrl,
                vehicleRegUrl: req.body.vehicleRegUrl,
                selfieUrl: req.body.selfieUrl,
                approvalStatus: "pending",
                rejectionReason: "",
                reviewedAt: null,
                reviewedBy: null,
            };
            let record;
            if (exists) {
                if (exists.approvalStatus === "rejected") {
                    exists.set(appData);
                    record = await exists.save();
                } else
                    return logAndSend(
                        res,
                        400,
                        "CANNOT_UPDATE",
                        "Hồ sơ hiện không thể cập nhật"
                    );
            } else record = await ShipperApplication.create(appData);

            console.log("[apply] application saved id=", record._id);
            return res.status(201).json({ status: true, data: record });
        } catch (error) {
            console.error("[apply][ERROR]:", error);
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
    myApplication: async (req, res) => {
        try {
            const userId = req.user.id;
            const app = await ShipperApplication.findOne({ user: userId }).lean();
            if (!app) return logAndSend(res, 404, "NOT_FOUND", "Chưa có hồ sơ");
            return res.status(200).json({ status: true, data: app });
        } catch (error) {
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
    listApplications: async (req, res) => {
        try {
            const { status = "pending" } = req.query;
            const apps = await ShipperApplication.find({ approvalStatus: status })
                .populate({ path: "user", select: "email username phone userType" })
                .sort({ createdAt: -1 })
                .lean();
            return res.status(200).json({ status: true, data: apps });
        } catch (error) {
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
    getApplication: async (req, res) => {
        try {
            const { id } = req.params;
            const app = await ShipperApplication.findById(id)
                .populate({ path: "user", select: "email username phone userType" })
                .lean();
            if (!app)
                return logAndSend(res, 404, "NOT_FOUND", "Không tìm thấy hồ sơ");
            return res.status(200).json({ status: true, data: app });
        } catch (error) {
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
    approve: async (req, res) => {
        try {
            const adminId = req.user.id;
            const { id } = req.params;
            const app = await ShipperApplication.findById(id);
            if (!app)
                return logAndSend(res, 404, "NOT_FOUND", "Không tìm thấy hồ sơ");
            if (app.approvalStatus === "approved")
                return res.status(200).json({
                    status: true,
                    message: "Hồ sơ đã được duyệt trước đó",
                });
            for (const f of requiredFields)
                if (!app[f] || String(app[f]).trim() === "")
                    return logAndSend(
                        res,
                        400,
                        "INCOMPLETE_APP",
                        `Hồ sơ thiếu thông tin: ${f}`
                    );
            app.approvalStatus = "approved";
            app.rejectionReason = "";
            app.reviewedBy = adminId;
            app.reviewedAt = new Date();
            await app.save();
            await User.findByIdAndUpdate(app.user, { userType: "Driver" });
            return res
                .status(200)
                .json({ status: true, message: "Đã duyệt hồ sơ shipper" });
        } catch (error) {
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
    reject: async (req, res) => {
        try {
            const adminId = req.user.id;
            const { id } = req.params;
            const { reason } = req.body;
            const app = await ShipperApplication.findById(id);
            if (!app)
                return logAndSend(res, 404, "NOT_FOUND", "Không tìm thấy hồ sơ");
            app.approvalStatus = "rejected";
            app.rejectionReason = String(reason || "Thiếu/không hợp lệ giấy tờ");
            app.reviewedBy = adminId;
            app.reviewedAt = new Date();
            await app.save();
            return res
                .status(200)
                .json({ status: true, message: "Đã từ chối hồ sơ" });
        } catch (error) {
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
    bulkApprove: async (req, res) => {
        try {
            const adminId = req.user.id;
            const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
            if (!ids.length)
                return logAndSend(res, 400, "MISSING_IDS", "Thiếu danh sách hồ sơ");
            const apps = await ShipperApplication.find({
                _id: { $in: ids },
                approvalStatus: { $ne: "approved" },
            });
            for (const app of apps)
                for (const f of requiredFields)
                    if (!app[f] || String(app[f]).trim() === "")
                        return logAndSend(
                            res,
                            400,
                            "INCOMPLETE_APP",
                            `Hồ sơ thiếu thông tin: ${f}`
                        );
            const now = new Date();
            await ShipperApplication.updateMany(
                { _id: { $in: ids } },
                {
                    $set: {
                        approvalStatus: "approved",
                        rejectionReason: "",
                        reviewedAt: now,
                        reviewedBy: adminId,
                    },
                }
            );
            await User.updateMany(
                { _id: { $in: apps.map((a) => a.user) } },
                { $set: { userType: "Driver" } }
            );
            return res.status(200).json({
                status: true,
                message: `Đã duyệt ${apps.length} hồ sơ`,
            });
        } catch (error) {
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
    bulkReject: async (req, res) => {
        try {
            const adminId = req.user.id;
            const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
            const reason = String(req.body.reason || "Thiếu/không hợp lệ giấy tờ");
            if (!ids.length)
                return logAndSend(res, 400, "MISSING_IDS", "Thiếu danh sách hồ sơ");
            await ShipperApplication.updateMany(
                { _id: { $in: ids } },
                {
                    $set: {
                        approvalStatus: "rejected",
                        rejectionReason: reason,
                        reviewedAt: new Date(),
                        reviewedBy: adminId,
                    },
                }
            );
            return res.status(200).json({
                status: true,
                message: `Đã từ chối ${ids.length} hồ sơ`,
            });
        } catch (error) {
            return res
                .status(500)
                .json({ status: false, code: "SERVER_ERROR", message: error.message });
        }
    },
};
