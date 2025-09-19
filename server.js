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
            name: "AI-Powered Code Review Assistant",
            slots: 4,
            description: `In modern software development, developers spend a significant amount of time reviewing code for bugs, inefficiencies, and compliance with coding standards. 
            Manual code reviews are often time-consuming and prone to human error, especially when projects involve large teams and rapidly evolving codebases. 
            The challenge is to develop an AI-powered assistant that can automatically analyze source code in real time and provide meaningful suggestions to improve quality. 
            Such a system should be capable of detecting syntax issues, logical bugs, and security vulnerabilities while also recommending best practices for optimization and readability. 
            Beyond simple static analysis, the assistant should learn from historical code reviews, adapting its recommendations over time to align with team-specific coding styles and project requirements. 
            It should integrate seamlessly into existing developer workflows, such as GitHub pull requests, GitLab merge requests, or IDE plugins, so that developers can access feedback without disrupting productivity.`,
            set: "Set 1"
        },
        {
            id: "2",
            name: "Real-Time Collaborative Code Editor",
            slots: 4,
            description: `Collaboration is at the heart of modern software engineering, with teams often distributed across different cities and time zones. 
            While version control systems like Git allow asynchronous collaboration, there is a growing need for tools that enable developers to collaborate in real time. 
            The challenge here is to build a web-based collaborative code editor that allows multiple programmers to work on the same file simultaneously, similar to how Google Docs works for documents. 
            Such a system must ensure low-latency synchronization of edits, conflict resolution when two users modify the same section of code, and a smooth user experience across devices. 
            It should include features like syntax highlighting, auto-completion, and error detection, making it comparable in power to desktop IDEs. 
            Beyond simple editing, the platform could integrate built-in chat, audio/video conferencing, or in-line commenting features to support richer team communication.`,
            set: "Set 1"
        },
        {
            id: "3",
            name: "Gamified Learning Platform for Programmers",
            slots: 4,
            description: `Learning to program can be intimidating for beginners, often involving abstract concepts and steep learning curves. 
            A gamified learning platform aims to make programming more engaging by combining education with elements of competition, rewards, and interactivity. 
            The challenge is to design a system where learners can progress through coding challenges, solve puzzles, and earn points, badges, or achievements. 
            Instead of passively reading tutorials, users actively engage with real coding problems that grow in difficulty as they progress. 
            The platform could offer leaderboards to encourage healthy competition, while also allowing learners to form study groups or compete in coding duels.`,
            set: "Set 1"
        },
        {
            id: "4",
            name: "Decentralized Social Media Platform",
            slots: 4,
            description: `Current social media platforms are dominated by centralized corporations that control user data, algorithms, and monetization models. 
            This creates issues of censorship, data privacy violations, and lack of transparency. 
            The goal of this project is to design a decentralized social media platform built on blockchain or distributed ledger technologies. 
            Such a platform would give users greater control over their data and content, ensuring that no single authority can manipulate feeds or exploit personal information for profit.`,
            set: "Set 1"
        },
        {
            id: "5",
            name: "IoT-Based Smart Home Automation System",
            slots: 4,
            description: `The Internet of Things (IoT) is revolutionizing how humans interact with their environments, particularly within smart homes. 
            A smart home automation system enables users to remotely monitor and control appliances, lighting, security systems, and environmental conditions. 
            The challenge is to design a secure, efficient, and scalable IoT-based system that provides convenience, energy savings, and enhanced safety.`,
            set: "Set 1"
        },
        {
            id: "6",
            name: "Automated Bug Tracking and Reporting System",
            slots: 4,
            description: `Bug tracking is one of the most critical processes in software development, yet many existing systems rely heavily on manual reporting and prioritization. 
            This project aims to create an automated bug tracking and reporting system that can detect issues in real time, categorize them, and prioritize fixes based on severity. 
            Such a system would integrate directly with development pipelines, continuously analyzing logs, test results, and runtime errors to identify bugs without waiting for manual reports.`,
            set: "Set 1"
        },
        {
            id: "7",
            name: "Cloud-Based IDE for Remote Development",
            slots: 4,
            description: `Traditional Integrated Development Environments (IDEs) often require local installation, configuration, and maintenance, creating challenges for remote teams and distributed learning environments. 
            A cloud-based IDE solves this by allowing developers to code, build, and debug applications entirely through the web, accessible from any device. 
            The challenge is to design a robust platform that provides the same power and flexibility as local IDEs while ensuring seamless performance in a browser.`,
            set: "Set 1"
        },
        {
            id: "8",
            name: "Personalized E-commerce Recommendation Engine",
            slots: 4,
            description: `E-commerce has transformed the way people shop, but personalization remains a key driver of customer engagement and loyalty. 
            A personalized recommendation engine analyzes user behavior, purchase history, and browsing patterns to suggest products that are most relevant to each individual. 
            The challenge is to design a recommendation system that balances accuracy, scalability, and diversity, ensuring customers receive suggestions that are useful without being repetitive.`,
            set: "Set 1"
        },
        {
            id: "9",
            name: "Live Code-Sharing and Pair Programming Tool",
            slots: 4,
            description: `Pair programming and live collaboration are powerful practices for improving code quality and knowledge sharing, but existing tools are often fragmented. 
            The challenge is to build a real-time code-sharing and pair programming tool that allows developers to work together as if sitting side by side. 
            Such a system should enable instant sharing of code sessions with features like synchronized cursors, highlighting, and split-screen editing. 
            Built-in voice or video chat could allow developers to communicate seamlessly while coding.`,
            set: "Set 1"
        },
        {
            id: "10",
            name: "Blockchain-Based Voting System",
            slots: 4,
            description: `Voting systems play a vital role in democratic societies, but traditional approaches often face issues of transparency, security, and accessibility. 
            A blockchain-based voting system could address these challenges by providing immutable, tamper-proof records of votes, ensuring both security and verifiability. 
            The system must balance anonymity and transparency, allowing voters to confirm their votes were counted without revealing personal identities.`,
            set: "Set 1"
        },
        {
            id: "11",
            name: "AI-Powered Healthcare Diagnosis Assistant",
            slots: 4,
            description: `Healthcare systems worldwide are under increasing strain, and diagnostic errors remain a serious concern. 
            An AI-powered healthcare diagnosis assistant could analyze patient symptoms, medical history, and test results to provide preliminary diagnostic suggestions. 
            The challenge is ensuring accuracy, reliability, and compliance with medical standards, while also integrating with hospital record systems and protecting patient privacy.`,
            set: "Set 2"
        },
        {
            id: "12",
            name: "Smart Traffic Management System",
            slots: 4,
            description: `Urban areas worldwide face increasing traffic congestion, leading to wasted time, fuel consumption, and environmental pollution. 
            A smart traffic management system could leverage IoT sensors, real-time traffic data, and AI algorithms to optimize traffic light timings, reduce bottlenecks, and improve road safety. 
            The challenge includes scalability, integration with existing infrastructure, and ensuring real-time responsiveness.`,
            set: "Set 2"
        },
        {
            id: "13",
            name: "AI-Based Financial Fraud Detection System",
            slots: 4,
            description: `Financial institutions face constant threats from fraud, including identity theft, money laundering, and unauthorized transactions. 
            An AI-based fraud detection system could monitor transactions in real time, identify suspicious patterns, and prevent fraudulent activity. 
            The system must strike a balance between minimizing false positives and catching genuine threats, while also being adaptable to evolving fraud techniques.`,
            set: "Set 2"
        },
        {
            id: "14",
            name: "Virtual Reality for Remote Education",
            slots: 4,
            description: `The COVID-19 pandemic highlighted the limitations of traditional online education. 
            Virtual reality (VR) can revolutionize remote learning by creating immersive classrooms, interactive labs, and collaborative virtual spaces. 
            The challenge is to design affordable, accessible VR educational platforms that engage students and enhance learning outcomes while remaining scalable for widespread adoption.`,
            set: "Set 2"
        },
        {
            id: "15",
            name: "AI-Powered Mental Health Chatbot",
            slots: 4,
            description: `Mental health is a growing concern worldwide, but access to trained professionals is limited, particularly in underserved regions. 
            An AI-powered mental health chatbot could provide preliminary support, active listening, and coping strategies to individuals experiencing stress, anxiety, or depression. 
            The challenge is ensuring empathy, accuracy, and safety, while also guiding users toward professional help when necessary.`,
            set: "Set 2"
        },
        {
            id: "16",
            name: "pro16",
            slots: 4,
            description: `Mental health is a growing concern worldwide, but access to trained professionals is limited, particularly in underserved regions. 
            An AI-powered mental health chatbot could provide preliminary support, active listening, and coping strategies to individuals experiencing stress, anxiety, or depression. 
            The challenge is ensuring empathy, accuracy, and safety, while also guiding users toward professional help when necessary.`,
            set: "Set 2"
        },
        {
            id: "17",
            name: "pro17",
            slots: 4,
            description: `Mental health is a growing concern worldwide, but access to trained professionals is limited, particularly in underserved regions. 
            An AI-powered mental health chatbot could provide preliminary support, active listening, and coping strategies to individuals experiencing stress, anxiety, or depression. 
            The challenge is ensuring empathy, accuracy, and safety, while also guiding users toward professional help when necessary.`,
            set: "Set 2"
        },
        {
            id: "18",
            name: "pro18",
            slots: 4,
            description: `Mental health is a growing concern worldwide, but access to trained professionals is limited, particularly in underserved regions. 
            An AI-powered mental health chatbot could provide preliminary support, active listening, and coping strategies to individuals experiencing stress, anxiety, or depression. 
            The challenge is ensuring empathy, accuracy, and safety, while also guiding users toward professional help when necessary.`,
            set: "Set 2"
        },
        {
            id: "19",
            name: "pro19",
            slots: 4,
            description: `Mental health is a growing concern worldwide, but access to trained professionals is limited, particularly in underserved regions. 
            An AI-powered mental health chatbot could provide preliminary support, active listening, and coping strategies to individuals experiencing stress, anxiety, or depression. 
            The challenge is ensuring empathy, accuracy, and safety, while also guiding users toward professional help when necessary.`,
            set: "Set 2"
        },
        {
            id: "20",
            name: "pro20",
            slots: 4,
            description: `Mental health is a growing concern worldwide, but access to trained professionals is limited, particularly in underserved regions. 
            An AI-powered mental health chatbot could provide preliminary support, active listening, and coping strategies to individuals experiencing stress, anxiety, or depression. 
            The challenge is ensuring empathy, accuracy, and safety, while also guiding users toward professional help when necessary.`,
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