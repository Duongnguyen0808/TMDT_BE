const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadImage } = require('../controllers/uploadController');
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

const upload = multer({ storage });

router.post('/image', verifyTokenAndAuthorization, upload.single('file'), uploadImage);

module.exports = router;