const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  message: { type: String, required: true },
  time: { type: Date, default: Date.now },
});

const Reminder = mongoose.model('Reminder', reminderSchema);

module.exports = Reminder;