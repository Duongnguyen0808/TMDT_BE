const Feedback = require("../models/Feedback");

module.exports = {
  // Gửi feedback
  createFeedback: async (req, res) => {
    const userId = req.user.id;
    const { subject, message, type, attachments } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        status: false,
        message: "Tiêu đề và nội dung không được để trống",
      });
    }

    try {
      const feedback = new Feedback({
        userId,
        subject,
        message,
        type: type || "Other",
        attachments: attachments || [],
      });

      await feedback.save();

      res.status(201).json({
        status: true,
        message:
          "Gửi phản hồi thành công. Chúng tôi sẽ xem xét và phản hồi sớm nhất.",
        data: feedback,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy tất cả feedback của user
  getUserFeedback: async (req, res) => {
    const userId = req.user.id;

    try {
      const feedbacks = await Feedback.find({ userId })
        .sort({ createdAt: -1 })
        .select("-__v");

      res.status(200).json(feedbacks);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Lấy chi tiết 1 feedback
  getFeedbackById: async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
      const feedback = await Feedback.findOne({ _id: id, userId }).populate(
        "userId",
        "username email"
      );

      if (!feedback) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy phản hồi",
        });
      }

      res.status(200).json(feedback);
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ADMIN: Lấy tất cả feedback
  getAllFeedback: async (req, res) => {
    try {
      const { status, type, priority, page = 1, limit = 20 } = req.query;

      const query = {};
      if (status) query.status = status;
      if (type) query.type = type;
      if (priority) query.priority = priority;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const feedbacks = await Feedback.find(query)
        .populate("userId", "username email phone profile")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Feedback.countDocuments(query);

      res.status(200).json({
        status: true,
        data: feedbacks,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ADMIN: Cập nhật trạng thái feedback
  updateFeedbackStatus: async (req, res) => {
    const { id } = req.params;
    const { status, priority, adminResponse } = req.body;

    try {
      const updateData = {};
      if (status) updateData.status = status;
      if (priority) updateData.priority = priority;
      if (adminResponse) updateData.adminResponse = adminResponse;

      const feedback = await Feedback.findByIdAndUpdate(id, updateData, {
        new: true,
      });

      if (!feedback) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy phản hồi",
        });
      }

      res.status(200).json({
        status: true,
        message: "Cập nhật phản hồi thành công",
        data: feedback,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // ADMIN: Xóa feedback
  deleteFeedback: async (req, res) => {
    const { id } = req.params;

    try {
      const feedback = await Feedback.findByIdAndDelete(id);

      if (!feedback) {
        return res.status(404).json({
          status: false,
          message: "Không tìm thấy phản hồi",
        });
      }

      res.status(200).json({
        status: true,
        message: "Xóa phản hồi thành công",
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  // Thống kê feedback
  getFeedbackStats: async (req, res) => {
    try {
      const stats = await Feedback.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]);

      const typeStats = await Feedback.aggregate([
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
          },
        },
      ]);

      const total = await Feedback.countDocuments();

      res.status(200).json({
        status: true,
        total,
        byStatus: stats,
        byType: typeStats,
      });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },
};
