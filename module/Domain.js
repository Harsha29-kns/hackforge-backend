const mongoose = require('mongoose');

const domainSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  slots: { type: Number, required: true, default: 10 },
  problemStatement: { type: String, required: true },
  features: { type: [String], default: [] },
  set: { type: String, required: true }, // <-- This line is added
});

const Domain = mongoose.model('Domain', domainSchema);

module.exports = Domain;