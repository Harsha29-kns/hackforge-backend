const mongoose = require("mongoose");
const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const cors = require("cors");

// --- Local Module Imports ---
const connectDB = require("./db");
const teamRoutes = require("./routes/teamRoutes");
const initializeSockets = require('./sockets/socketHandler');

// --- Schema Imports ---
const hackforge = require("./module/hackforge");
const Domain = require("./module/Domain");
const ServerSetting = require("./module/ServerSetting");

// --- Server Setup ---
const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: "*" } });

// --- Global State Variables ---
let settings;
let currentRegistrationCount = 0;
const activeTeamSessions = new Map();

// --- Core Middleware ---
app.use(cors({ origin: "*" }));
app.use(express.json());

// --- Global Routes ---
app.get("/", (req, res) => {
    res.send("hi i am Checkpoint server");
});

// --- API to fetch domains ---
app.get("/domains", async (req, res) => {
    try {
        const domains = await Domain.find({});
        const mapped = domains.map((d) => ({
            ...d.toObject(),
            isFull: d.slots <= 0,
        }));
        res.status(200).json(mapped);
    } catch (error) {
        console.error("Error fetching domains:", error);
        res.status(500).json({ message: "Server error while fetching domains." });
    }
});

// --- ADMIN-ONLY API ROUTES ---
app.post('/api/admin/clear-all-sessions', (req, res) => {

    const secret = req.headers['x-admin-secret'];
    if (secret !== 'clean') { // clean used for deletion of sessions
        return res.status(403).json({ message: 'Forbidden: Invalid admin secret.' });
    }

    try {
        const sessionsCleared = activeTeamSessions.size;

        // Clear the entire session map
        activeTeamSessions.clear();

        console.log(`[ADMIN ACTION] Cleared ${sessionsCleared} active team sessions.`);

        // Notify all connected clients about session clearance
        io.emit('admin:activeSessionsUpdate', { count: 0 });

        res.status(200).json({
            success: true,
            message: `Successfully cleared ${sessionsCleared} active sessions.`
        });

    } catch (error) {
        console.error("Error clearing sessions:", error);
        res.status(500).json({ message: "An internal server error occurred." });
    }
});

// --- Utility Functions ---
const checkRegistrationStatus = async () => {
    try {
        if (!settings) {
            console.log("Settings not loaded yet, skipping registration check.");
            return;
        }
        const count = await hackforge.countDocuments({});
        currentRegistrationCount = count;
        const isBeforeOpenTime = settings.registrationOpenTime && new Date() < new Date(settings.registrationOpenTime);
        const isFull = count >= settings.registrationLimit;
        const isClosed = !!(isFull || settings.isForcedClosed || isBeforeOpenTime);
        io.emit("registrationStatus", {
            isClosed: isClosed,
            count: count,
            limit: settings.registrationLimit,
            openTime: settings.registrationOpenTime,
        });
    } catch (error) {
        console.error("Error checking registration status:", error);
    }
};
//temp domains
const initializeDomains = async () => {
    try {
        const count = await Domain.countDocuments();
        if (count === 0) {
            console.log("No domains found in DB. Initializing...");
            const initialDomains = [
        {
            id: "1",
            name: "Smart Campus Navigator",
            slots: 4,
            description: `A digital solution to help students locate classrooms, labs, and faculty cabins with real-time updates on availability. An admin panel should allow campus authorities to update room schedules and changes instantly.`,
            set: "Set 1"
        },
        {
            id: "2",
            name: "Skill and Book Exchange Platform",
            slots: 4,
            description: `Users can list books for sale or exchange and post skills they want to teach or learn. The platform includes secure messaging, basic scheduling for skill sessions, and an admin panel for moderation.`,
            set: "Set 1"
        },
        {
            id: "3",
            name: "Online Examination & Gamified Quiz Platform",
            slots: 4,
            description: `The platform allows educators to create secure exams with randomized questions and timed sessions, while also offering an interactive quiz mode for practice and competition. Results are automatically generated, and leaderboards display top performers.`,
            set: "Set 1"
        },
        {
            id: "4",
            name: "Event Management & Ticketing System",
            slots: 4,
            description: ` A platform where organizations can host events, manage registrations, and issue QR-coded tickets. Admins should track attendance in real time, while participants can register and store tickets digitally.`,
            set: "Set 1"
        },
        {
            id: "5",
            name: "Crowdsourced Travel Planner",
            slots: 4,
            description: `A platform where users can create and share travel itineraries. Other users can vote, save, or customize itineraries. The system should support collaborative trip planning with budget breakdowns, timelines, and location maps.`,
            set: "Set 1"
        },
        {
            id: "6",
            name: "Digital Voting System (College Elections)",
            slots: 4,
            description: ` A voting system that enables students to cast votes securely online. It should include unique voter authentication, prevent duplicate voting, and display results in real time.`,
            set: "Set 1"
        },
        {
            id: "7",
            name: "Blockchain-Based Certificate Verification",
            slots: 4,
            description: `A platform for universities or organizations to issue tamper-proof digital certificates stored on the blockchain. Employers or third parties should be able to verify the authenticity of certificates instantly.`,
            set: "Set 1"
        },
        {
            id: "8",
            name: "Ride Sharing",
            slots: 4,
            description: `A web/mobile app where people can post available rides or join others heading to the same destination. The system should prioritize safety, include verification mechanisms, and allow ratings for both drivers and passengers.`,
            set: "Set 1"
        },
        {
            id: "9",
            name: "Campus Lost & Found Portal",
            slots: 4,
            description: `A web platform for students to report, track, and claim lost or found items on campus with secure claim verification.`,
            set: "Set 1"
        },
        {
            id: "10",
            name: "Smart Restaurant Ordering System",
            slots: 4,
            description: `Restaurants often face delays, order errors, and long wait times due to manual processes. Customers want faster, contactless service, while owners need better insights and chefs require organized order flow.Build a QR code–based digital dining solution where customers can view menus, place orders, and pay online. The system should include a  kitchen dashboard, live food status, and analytics for owners, with optional features like AI recommendations, reservations, and loyalty rewards.`,
            set: "Set 1"
        },
        {
            id: "11",
            name: "Personalized News Aggregator",
            slots: 4,
            description: `A news aggregation and personalization platform with smart recommendations.`,
            set: "Set 2"
        },
        {
            id: "12",
            name: "AI Career Guidance Portal",
            slots: 4,
            description: `A web app for AI-driven career counseling, skill tracking, and mentorship connections.`,
            set: "Set 2"
        },
        {
            id: "13",
            name: "E-Commerce with Auction System",
            slots: 4,
            description: `A marketplace supporting both fixed-price sales and competitive bidding.`,
            set: "Set 2"
        },
        {
            id: "14",
            name: "Digital Wardrobe & Outfit Recommender",
            slots: 4,
            description: `A personal wardrobe management and AI-powered outfit suggestion platform that helps users organize their clothes and get personalized fashion recommendations.`,
            set: "Set 2"
        },
        {
            id: "15",
            name: "Smart Healthcare Appointment System",
            slots: 4,
            description: `A healthcare appointment and management platform for patients, doctors, and hospitals with telemedicine support.`,
            set: "Set 2"
        },
        {
            id: "16",
            name: "Creative Hangout – AI Story Builder & Movie Night Planner",
            slots: 4,
            description: `A web platform where friends can collaborate on creative storytelling with AI assistance and also plan movie nights together.`,
            set: "Set 2"
        },
        {
            id: "17",
            name: "Smart Recipe Book, Meal Planner & Group Cook-Along",
            slots: 4,
            description: ` A full-stack platform where users can upload and save their favorite recipes, plan meals, and track calorie intake. Includes group cook-alongs for collaborative cooking.`,
            set: "Set 2"
        },
        {
            id: "18",
            name: "Smart Grocery & Bill Management Platform",
            slots: 4,
            description: `A platform for grocery list management, bill uploads, and personal finance tracking. Includes dashboards and calculators.`,
            set: "Set 2"
        },
        {
            id: "19",
            name: "AI-Powered Study & Gamified Language Learning Platform",
            slots: 4,
            description: `The platform allows students to upload notes and get AI-generated study aids while also supporting gamified language learning.`,
            set: "Set 2"
        },
        {
            id: "20",
            name: "Faculty-Student Project Management & Review System",
            slots: 4,
            description: `A digital platform to manage academic projects, internships, or assignments where faculties can assign projects, monitor progress, review submissions, and provide grades/feedback. Students can submit work, track deadlines, communicate with faculty, and view their evaluations.`,
            set: "Set 2"
        }
    ];


            await Domain.insertMany(initialDomains);
            console.log("Domains have been successfully initialized in the database.");
        }
    } catch (error) {
        console.error("Error initializing domains:", error);
    }
};

const initializeSettings = async () => {
    try {
        const existingSettings = await ServerSetting.findOne({ singleton: "main" });
        if (!existingSettings) {
            console.log("No server settings found. Creating default settings document...");
            settings = new ServerSetting();
            await settings.save();
            console.log("Default settings created in the database.");
        } else {
            settings = existingSettings;
            console.log("Server settings loaded from the database.");
        }
    } catch (error) {
        console.error("Error initializing server settings:", error);
        process.exit(1);
    }
};


// --- Server Start Logic ---
const startServer = async () => {
    await connectDB();
    await initializeDomains();
    await initializeSettings();

    // Custom middleware must be applied *after* settings are loaded
    app.use((req, res, next) => {
        req.io = io;
        req.registrationLimit = settings.registrationLimit;
        const isBeforeOpenTime = settings.registrationOpenTime && new Date() < new Date(settings.registrationOpenTime);
        const isFull = currentRegistrationCount >= settings.registrationLimit;
        req.isRegClosed = isFull || settings.isForcedClosed || isBeforeOpenTime;
        next();
    });

    // Mount the main router
    app.use("/Hack", teamRoutes(activeTeamSessions));

    // Initialize Socket.IO event listeners
    initializeSockets(io, settings, checkRegistrationStatus, activeTeamSessions);
    
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
    });

    // Periodically check registration status
    setInterval(checkRegistrationStatus, 10000);
};

startServer();