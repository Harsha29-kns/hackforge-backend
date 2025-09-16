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
            slots: 10,
            description: `In modern software development, developers spend a significant amount of time reviewing code for bugs, inefficiencies, and compliance with coding standards. 
            Manual code reviews are often time-consuming and prone to human error, especially when projects involve large teams and rapidly evolving codebases. 
            The challenge is to develop an AI-powered assistant that can automatically analyze source code in real time and provide meaningful suggestions to improve quality. 
            Such a system should be capable of detecting syntax issues, logical bugs, and security vulnerabilities while also recommending best practices for optimization and readability. 
            Beyond simple static analysis, the assistant should learn from historical code reviews, adapting its recommendations over time to align with team-specific coding styles and project requirements. 
            It should integrate seamlessly into existing developer workflows, such as GitHub pull requests, GitLab merge requests, or IDE plugins, so that developers can access feedback without disrupting productivity. 
            The system should also provide clear explanations for its suggestions, helping developers understand why a particular change is recommended rather than just flagging errors. 
            Ideally, it would support multiple programming languages and frameworks, ensuring flexibility across diverse projects. 
            Advanced implementations could incorporate natural language processing to summarize feedback in human-readable form, highlight sections of code most likely to cause runtime errors, and even auto-generate potential fixes for common issues. 
            Another important aspect is ensuring trustworthiness: the AI must avoid over-flagging trivial issues and instead focus on actionable improvements that truly enhance the codebase. 
            To foster team collaboration, the assistant could also maintain a dashboard showing metrics like recurring bug patterns, review turnaround times, and quality improvements over project iterations. 
            By leveraging machine learning, the tool should get smarter with use, continuously refining its ability to detect subtle bugs and security risks as more data is processed. 
            Such a system could dramatically reduce the overhead of manual code reviews, speed up software release cycles, and help developers—especially juniors—learn better coding practices through consistent feedback. 
            At its core, the problem revolves around blending artificial intelligence with practical software engineering needs, ensuring the tool is not only technically powerful but also intuitive, reliable, and developer-friendly.`,
            set: "Set 1"
        },
        {
            id: "2",
            name: "Real-Time Collaborative Code Editor",
            slots: 10,
            description: `Collaboration is at the heart of modern software engineering, with teams often distributed across different cities and time zones. 
            While version control systems like Git allow asynchronous collaboration, there is a growing need for tools that enable developers to collaborate in real time. 
            The challenge here is to build a web-based collaborative code editor that allows multiple programmers to work on the same file simultaneously, similar to how Google Docs works for documents. 
            Such a system must ensure low-latency synchronization of edits, conflict resolution when two users modify the same section of code, and a smooth user experience across devices. 
            It should include features like syntax highlighting, auto-completion, and error detection, making it comparable in power to desktop IDEs. 
            Beyond simple editing, the platform could integrate built-in chat, audio/video conferencing, or in-line commenting features to support richer team communication. 
            Security is another key consideration: user authentication, secure data storage, and encrypted transmission are crucial for protecting intellectual property. 
            The editor must be highly scalable, capable of supporting classrooms, hackathons, or enterprise-level teams without performance degradation. 
            Additional advanced features could include live debugging sessions, shared terminals, and integrated testing environments, allowing developers to not only write but also run and debug code together. 
            A version history or playback feature would enable users to review the development process and recover from mistakes. 
            Integrations with GitHub or GitLab would allow seamless push/pull of projects. 
            The ultimate goal is to create a real-time collaborative development platform that brings the benefits of both remote teamwork and traditional in-person coding sessions, significantly reducing communication barriers and boosting productivity.`,
            set: "Set 2"
        },
        {
            id: "3",
            name: "Gamified Learning Platform for Programmers",
            slots: 10,
            description: `Learning to program can be intimidating for beginners, often involving abstract concepts and steep learning curves. 
            A gamified learning platform aims to make programming more engaging by combining education with elements of competition, rewards, and interactivity. 
            The challenge is to design a system where learners can progress through coding challenges, solve puzzles, and earn points, badges, or achievements. 
            Instead of passively reading tutorials, users actively engage with real coding problems that grow in difficulty as they progress. 
            The platform could offer leaderboards to encourage healthy competition, while also allowing learners to form study groups or compete in coding duels. 
            Personalization is a key aspect: the system should adapt to a learner’s skill level, offering hints or alternative exercises when someone is stuck. 
            Integration of storytelling elements, like progressing through a virtual world by solving coding tasks, can make the experience more immersive. 
            To broaden impact, the platform should support multiple programming languages and domains, from web development to AI and algorithms. 
            Advanced analytics can help instructors or mentors track student progress, identify common weaknesses, and tailor lessons accordingly. 
            A mobile-friendly design would allow learners to practice on the go, ensuring accessibility. 
            Security features should prevent plagiarism and ensure fairness in competitions. 
            The ultimate vision is to transform coding education from a solitary and sometimes discouraging experience into a fun, community-driven journey where students are motivated to keep learning and improving.`,
            set: "Set 3"
        },
        {
            id: "4",
            name: "Decentralized Social Media Platform",
            slots: 10,
            description: `Current social media platforms are dominated by centralized corporations that control user data, algorithms, and monetization models. 
            This creates issues of censorship, data privacy violations, and lack of transparency. 
            The goal of this project is to design a decentralized social media platform built on blockchain or distributed ledger technologies. 
            Such a platform would give users greater control over their data and content, ensuring that no single authority can manipulate feeds or exploit personal information for profit. 
            Challenges include designing a scalable architecture that can handle millions of users while still maintaining decentralization and performance. 
            Features such as end-to-end encryption, tokenized incentives for content creators, and decentralized moderation systems need to be incorporated. 
            A transparent reputation system could help prevent abuse while maintaining freedom of speech. 
            To attract adoption, the platform should offer a user-friendly interface, seamless onboarding, and mobile accessibility. 
            Integrating NFTs or other blockchain assets could open up new monetization avenues for creators. 
            Another important challenge is ensuring affordability and low transaction costs for users in regions with limited financial resources. 
            The system could be governed through community voting, allowing users to have a direct say in platform policies and feature rollouts. 
            By leveraging blockchain, this project has the potential to redefine social media, shifting power back to users and fostering a healthier online ecosystem.`,
            set: "Set 2"
        },
        {
            id: "5",
            name: "IoT-Based Smart Home Automation System",
            slots: 10,
            description: `The Internet of Things (IoT) is revolutionizing how humans interact with their environments, particularly within smart homes. 
            A smart home automation system enables users to remotely monitor and control appliances, lighting, security systems, and environmental conditions. 
            The challenge is to design a secure, efficient, and scalable IoT-based system that provides convenience, energy savings, and enhanced safety. 
            The system should support multiple devices, such as smart thermostats, door locks, cameras, and lighting solutions, all controlled through a unified dashboard. 
            It should allow users to set schedules, define automation rules (e.g., turn off lights when no one is home), and receive alerts in case of unusual activity. 
            Interoperability with existing smart devices and platforms like Alexa or Google Home would broaden adoption. 
            Security is paramount, as vulnerabilities in IoT systems can expose households to cyber threats. 
            Therefore, encryption, device authentication, and secure firmware updates must be built in. 
            The platform should also consider edge computing to minimize latency and improve reliability during internet outages. 
            Advanced features could include AI-driven energy optimization, real-time anomaly detection (e.g., detecting a fire or gas leak), and predictive maintenance for appliances. 
            A mobile app interface would allow users to manage everything conveniently, while voice-control support would improve accessibility. 
            Ultimately, this project envisions creating a smart home ecosystem that is not only intelligent but also safe, reliable, and adaptable to the evolving needs of modern households.`,
            set: "Set 3"
        },
        {
            id: "6",
            name: "Automated Bug Tracking and Reporting System",
            slots: 10,
            description: `Bug tracking is one of the most critical processes in software development, yet many existing systems rely heavily on manual reporting and prioritization. 
            This project aims to create an automated bug tracking and reporting system that can detect issues in real time, categorize them, and prioritize fixes based on severity. 
            Such a system would integrate directly with development pipelines, continuously analyzing logs, test results, and runtime errors to identify bugs without waiting for manual reports. 
            Natural language processing could be used to summarize crash reports into actionable items for developers. 
            The system should automatically assign bugs to relevant team members based on expertise, project history, or workload balancing. 
            A user-friendly dashboard would allow managers to view bug statistics, track resolution times, and identify recurring issues. 
            To ensure scalability, the system should support large projects with thousands of issues while maintaining speed and reliability. 
            Integration with version control systems like Git would allow bugs to be linked to specific commits, improving traceability. 
            Prioritization algorithms could help teams focus on high-impact issues first, reducing downtime and improving overall product stability. 
            Notifications via email, chat, or project management tools would keep teams updated in real time. 
            By automating much of the manual overhead, this system would allow developers to spend less time managing bugs and more time writing quality code, ultimately improving productivity and product reliability.`,
            set: "Set 1"
        },
        {
            id: "7",
            name: "Cloud-Based IDE for Remote Development",
            slots: 10,
            description: `Traditional Integrated Development Environments (IDEs) often require local installation, configuration, and maintenance, creating challenges for remote teams and distributed learning environments. 
            A cloud-based IDE solves this by allowing developers to code, build, and debug applications entirely through the web, accessible from any device. 
            The challenge is to design a robust platform that provides the same power and flexibility as local IDEs while ensuring seamless performance in a browser. 
            Features should include syntax highlighting, intelligent auto-completion, debugging tools, integrated terminals, and version control integration. 
            To support collaborative use cases, the IDE could allow multiple developers to work on the same project in real time. 
            Scalability and security are critical, ensuring projects of all sizes can be handled safely. 
            The IDE must also provide customizable environments so developers can work with different programming languages, frameworks, and dependencies without conflicts. 
            Cloud-based execution environments should minimize latency while handling compute-intensive tasks. 
            Offline access and sync capabilities could be included for resilience during connectivity interruptions. 
            Integration with learning management systems or coding bootcamps would expand its utility in education. 
            The ultimate goal is to democratize software development by making professional-grade tools available anywhere, reducing setup barriers and enabling remote collaboration at scale.`,
            set: "Set 1"
        },
        {
            id: "8",
            name: "Personalized E-commerce Recommendation Engine",
            slots: 10,
            description: `Innovate in education technology.`,
            set: "Set 3"
        },
        {
            id: "9",
            name: "Live Code-Sharing and Pair Programming Tool",
            slots: 10,
            description: `Pair programming and live collaboration are powerful practices for improving code quality and knowledge sharing, but existing tools are often fragmented. 
            The challenge is to build a real-time code-sharing and pair programming tool that allows developers to work together as if sitting side by side. 
            Such a system should enable instant sharing of code sessions with features like synchronized cursors, highlighting, and split-screen editing. 
            Built-in voice or video chat could allow developers to communicate seamlessly while coding. 
            To support mentoring and education, the tool could include a "follow mode," where one participant leads and others observe, switching roles dynamically. 
            The platform should also support collaborative debugging, allowing multiple users to inspect variables, set breakpoints, and step through execution together. 
            Security features such as session encryption, access control, and time-limited sharing are essential. 
            Scalability is important, ensuring the tool performs well for small teams as well as larger classrooms or workshops. 
            Integration with existing development environments, Git repositories, and project management tools would make the system more versatile. 
            Ultimately, this project envisions a seamless, real-time environment that fosters better collaboration, accelerates problem solving, and enhances both learning and professional development in software engineering contexts.`,
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