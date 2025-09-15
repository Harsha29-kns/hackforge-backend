const mongoose = require('mongoose');

// --- SUB-SCHEMAS (No changes here) ---
const attendanceSchema = new mongoose.Schema({
    round: Number,
    status: { type: String, enum: ['Present', 'Absent'], default: 'Absent' }
}, { _id: false });

const teamMemberSchema = new mongoose.Schema({
    name: String,
    registrationNumber: String,
    room: String,
    type: String,
    year: String,
    department: String,
    section: String,
    qrCode: String,
    attendance: [attendanceSchema]
}, { _id: false });

const leadSchema = new mongoose.Schema({
    qrCode: String,
    attendance: [attendanceSchema],
    GameScore: Number
}, { _id: false, strict: false });


// --- MAIN EVENT SCHEMA ---
const eventSchema = new mongoose.Schema({
    teamname: String,
    email: String,
    name: String,
    registrationNumber: String,
    room: String,
    type: String,
    year: String,
    department: String,
    section: String,
    lead: leadSchema,
    teamMembers: [teamMemberSchema],
    upiId: String,
    transtationId: String,
    imgUrl: String,
    verified: { type: Boolean, default: false },
    Domain: String,
    GameScore: Number,
    
    // THIS IS THE FIX
    password: {
        type: String,
        index: true, // <-- ADD THIS LINE to make logins extremely fast
    },
    
    FirstReview: Object,
    SecoundReview: Object,
    memoryGameScore: { type: Number, default: null },
    memoryGamePlayed: { type: Boolean, default: false },
    numberPuzzleScore: { type: Number, default: null },
    numberPuzzlePlayed: { type: Boolean, default: false },
    internalGameScore: { type: Number, default: 0 },
    stopTheBarScore: { type: Number, default: null },
    stopTheBarPlayed: { type: Boolean, default: false },
    FirstReviewScore: { type: Number, default: 0 },
    SecoundReviewScore: { type: Number, default: 0 },
    FinalScore: Number,
    Sector: String,
    issues: [{
        text: String,
        status: { type: String, default: 'Pending' },
        timestamp: { type: Date, default: Date.now }
    }]
});

const Event = mongoose.model("hackforge", eventSchema);
module.exports = Event;