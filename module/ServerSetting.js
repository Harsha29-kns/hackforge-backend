const mongoose = require('mongoose');

const serverSettingSchema = new mongoose.Schema({
    // Using a singleton pattern with a known ID for easy retrieval
    singleton: { type: String, default: 'main', unique: true },

    registrationLimit: { type: Number, default: 60 },
    registrationOpenTime: { type: Date, default: null },
    isForcedClosed: { type: Boolean, default: false },
    domainStat: { type: Boolean, default: false }, // Can also be a Date if you prefer
    latestEventUpdate: { type: String, default: "" },
    gameOpenTime: { type: Date, default: null },
    puzzleOpenTime: { type: Date, default: null },
    stopTheBarOpenTime: { type: Date, default: null },
    isFirstReviewOpen: { type: Boolean, default: false }, // New field for first review
    isSecondReviewOpen: { type: Boolean, default: false }, // New field for second review

});

const ServerSetting = mongoose.model('ServerSetting', serverSettingSchema);

module.exports = ServerSetting;