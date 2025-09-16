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

                    { id: "1", name: "AI-Powered Code Review Assistant", slots: 10, description: "Develop a tool that uses AI to automatically review code, suggest improvements, and identify potential bugs.", set: "Set 1" },
                    { id: "2", name: "Real-Time Collaborative Code Editor", slots: 10, description: "Build a web-based code editor that allows multiple users to code in the same file simultaneously.", set: "Set 2" },
                    { id: "3", name: "Gamified Learning Platform for Programmers", slots: 10, description: "Create an interactive platform where users can learn to code by completing challenges and earning rewards.", set: "Set 3" },
                    { id: "4", name: "Decentralized Social Media Platform", slots: 10, description: "Design a social media application that operates on a blockchain network, giving users more control over their data.", set: "Set 2" },
                    { id: "5", name: "IoT-Based Smart Home Automation System", slots: 10, description: "Develop a system to control and monitor home appliances remotely using IoT devices.", set: "Set 3" },
                    { id: "6", name: "Automated Bug Tracking and Reporting System", slots: 10, description: "Build a system that automatically detects, reports, and prioritizes bugs in a software project.", set: "Set 1" },
                    { id: "7", name: "Cloud-Based IDE for Remote Development", slots: 10, description: "Create a cloud-based Integrated Development Environment (IDE) that can be accessed from any device.", set: "Set 1" },
                    { id: "8", name: "Personalized E-commerce Recommendation Engine", slots: 10, description: "Develop a recommendation system that provides personalized product suggestions to e-commerce users.", set: "Set 3" },
                    { id: "9", name: "Live Code-Sharing and Pair Programming Tool", slots: 10, description: "Create a tool that allows developers to share their code in real-time and collaborate on projects.", set: "Set 2" }
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