const mongoose = require('mongoose');
const attendanceSchema = new mongoose.Schema({
    round: Number,
    status: { type: String, enum: ['Present', 'Absent'], default: 'Absent' }
}, { _id: false });

const teamMemberSchema = new mongoose.Schema({
    name: String,
    registrationNumber: String,
    room: String,
    type: String,
    year: String,         // <-- ADDED
    department: String,   // <-- ADDED
    section: String,      // <-- ADDED
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
    
    // Team Lead's Details
    name: String,
    registrationNumber: String,
    room: String,
    type: String,
    year: String,         // <-- ADDED
    department: String,   // <-- ADDED
    section: String,      // <-- ADDED

    // Updated fields
    lead: leadSchema,
    teamMembers: [teamMemberSchema],
    
    // Existing fields
    upiId: String,
    transtationId: String,
    imgUrl: String,
    verified: { type: Boolean, default: false },
    Domain: String,
    GameScore: Number,
    password: String,
    FirstReview: Object,
    SecoundReview: Object,
    memoryGameScore: { type: Number, default: null },
    memoryGamePlayed: { type: Boolean, default: false },
    numberPuzzleScore: { type: Number, default: null }, // ADD THIS
    numberPuzzlePlayed: { type: Boolean, default: false }, // ADD THIS
    internalGameScore: { type: Number, default: 0 },
    stopTheBarScore: { type: Number, default: null }, // <-- ADD THIS
    stopTheBarPlayed: { type: Boolean, default: false }, // <-- ADD THIS
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

// This function remains unchanged as it works with existing fields.
async function data() {
    const teams = await Event.find({});
    let pass = [];
    for (let i of teams) {
        const password = i.registrationNumber.slice(-1) + i.teamMembers.map((i) => { return i.registrationNumber.slice(-1) }).join("");
        if (pass.includes(password)) {
            console.log("wrong", password, i.teamname);
        } else {
            console.log(i.teamname, password);
            i.password = password;
        }
        await i.save();
    }
    console.log("done");
}
// data()