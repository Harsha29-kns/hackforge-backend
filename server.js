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
    if (secret !== 'clean') { // Replace with a real secret from your environment variables
        return res.status(403).json({ message: 'Forbidden: Invalid admin secret.' });
    }

    try {
        const sessionsCleared = activeTeamSessions.size;

        // Clear the entire session map
        activeTeamSessions.clear();

        console.log(`[ADMIN ACTION] Cleared ${sessionsCleared} active team sessions.`);

        // Notify all connected clients (especially admins) that the count is now 0
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

const initializeDomains = async () => {
    try {
        const count = await Domain.countDocuments();
        if (count === 0) {
            console.log("No domains found in DB. Initializing...");
            const initialDomains = [
                { id: "1", name: "Cybersecurity", slots: 10, description: "Focus on digital security and defense.", set: "Set 1" },
                { id: "2", name: "AI/ML", slots: 10, description: "Develop intelligent systems and models.", set: "Set 1" },
                { id: "3", name: "Web Development", slots: 10, description: "Build modern web applications.", set: "Set 2" },
                { id: "4", name: "Mobile App Dev", slots: 10, description: "Create applications for mobile devices.", set: "Set 2" },
                { id: "5", name: "IoT", slots: 10, description: "Connect physical devices to the internet.", set: "Set 3" },
                { id: "6", name: "Blockchain", slots: 10, description: "Work with decentralized technologies.", set: "Set 3" },
                { id: "7", name: "Cloud Computing", slots: 10, description: "Leverage cloud platforms and services.", set: "Set 1" },
                { id: "8", name: "Digital Learning Platforms", slots: 10, description: "Innovate in education technology.", set: "Set 3" },
                { id: "9", name: "Student Engagement", slots: 10, description: "Enhance student interaction and experience.", set: "Set 2" },
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
    app.use("/Hack", teamRoutes);

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