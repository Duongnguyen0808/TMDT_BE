const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadImage, publicUploadImage } = require('../controllers/uploadController');
const { verifyTokenAndAuthorization } = require('../middleware/verifyToken');

const uploadDir = path.join(process.cwd(), 'tmp_uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '.jpg');
    cb(null, unique + ext);
  },
});

// Generic authenticated upload
const upload = multer({ storage });
// Public shipper doc upload with size limit (5MB) & relaxed mime filter
// Một số thiết bị Android trả về application/octet-stream nên ta kiểm tra thêm phần mở rộng.
const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'];
const publicUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isImageMime = /^image\//.test(file.mimetype);
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!isImageMime && !allowedExt.includes(ext)) {
      return cb(new Error('Chỉ cho phép hình ảnh (jpg, png, webp, gif, heic)'));
    }
    cb(null, true);
  }
});

router.post('/image', verifyTokenAndAuthorization, upload.single('file'), uploadImage);
// Public doc upload (no auth) - limited to shipper docs
router.post('/public/shipper-doc', (req, res) => {
  publicUpload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ status: false, message: err.message });
    }
    publicUploadImage(req, res);
  });
});

module.exports = router;