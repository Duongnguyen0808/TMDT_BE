const cloudinary = require("cloudinary").v2;

const uploadImage = async (req, res) => {
  try {
    // Config Cloudinary inside function to ensure env vars are loaded
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const file = req.file;
    const folder = (req.body.folder || "tmdt").toString();
    if (!file) {
      return res
        .status(400)
        .json({ status: false, message: "No file provided" });
    }
    const result = await cloudinary.uploader.upload(file.path, {
      folder,
      resource_type: "image",
      overwrite: true,
    });
    return res.status(200).json({
      status: true,
      secure_url: result.secure_url,
      url: result.secure_url,
      public_id: result.public_id,
    });
  } catch (error) {
    console.error("[upload][image] error:", error);
    return res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = { uploadImage };
