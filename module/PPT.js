const mongoose = require('mongoose');

const pptSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true }, // Added a field for the URL/path to the PPT
  uploadedAt: { type: Date, default: Date.now },
});

const PPT = mongoose.model('PPT', pptSchema);

module.exports = PPT;