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
const hacksail = require("./module/hacksail");
const Domain = require("./module/Domain");
const ServerSetting = require("./module/ServerSetting");
const { features } = require("process");

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
        const count = await hacksail.countDocuments({});
        currentRegistrationCount = count;
        const isBeforeOpenTime = settings.registrationOpenTime && new Date() < new Date(settings.registrationOpenTime);
        const isFull = count >= settings.registrationLimit;
        const isClosed = !!(isFull || settings.isForcedClosed || isBeforeOpenTime);

        // Detailed logging for debugging
        {/*/  console.log(`[${new Date().toISOString()}] Registration Status:`, {
            count,
            limit: settings.registrationLimit,
            isFull,
            isBeforeOpenTime,
            isClosed,
            openTime: settings.registrationOpenTime
        });
        */}

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
                    name: "EquiSkill AI: Inclusive & Universal Assessment Ecosystem",
                    slots: 3,
                   problemStatement: "The current skill assessment ecosystem relies on fragmented and inconsistent evaluation methods across schools, ITIs, and vocational training centers. Written exams, MCQs, and viva assessments are often conducted using separate tools or manual processes, leading to inefficiencies, lack of standardization, and delayed evaluation. Existing systems also fail to adequately support Persons with Disabilities (PWD), limiting accessibility and equal participation in assessments. Additionally, institutions in rural or underserved areas face challenges due to unreliable internet connectivity, making fully online examination systems difficult to implement. There is a need for a unified AI-powered assessment platform that ensures inclusive, standardized, and reliable evaluation while supporting multiple exam formats and adaptable deployment across online, offline, and blended learning environments.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"
                },
                {
                    id: "2",
                    name: "AI-Powered Video Understanding & Learning Assistant",
                    slots: 3,
                    problemStatement: "Students and professionals frequently rely on long educational videos from platforms such as YouTube and online learning portals to understand new concepts. However, extracting meaningful information from lengthy videos is often time-consuming and inefficient. Users must manually watch entire videos to locate important explanations, key insights, or specific topics they need to learn or review. This process reduces learning efficiency and makes it difficult to quickly revisit important sections or clarify doubts. There is a growing need for an AI-powered intelligent system that can automatically analyze video content, understand the information being presented, generate useful insights, and help users quickly access the most relevant knowledge from educational videos.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"
                },
                {
                    id: "3",
                    name: "OptiTask AI: Neural Workload Balancing & Cognitive Task Allocation",
                    slots: 3,
                    problemStatement: "In many organizations, tasks are still assigned based on simple availability, manual judgment, or fixed role definitions. This approach often ignores important factors such as employee skill specialization, changing performance patterns, task complexity, and mental workload. As a result, some employees become overloaded while others remain underutilized, leading to reduced productivity, burnout risks, and inefficient use of team capabilities. Managers also lack real-time insights to balance workloads effectively as project priorities shift. There is a need for an AI-powered intelligent system that can analyze workforce skills, task requirements, and workload patterns to enable smarter, fairer, and more efficient task allocation across teams.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"

                },
                {
                    id: "4",
                    name: "AgriGuard AI: Computer Vision & Predictive Analytics for Farm Health",
                    slots: 3,
                    problemStatement: "Farmers in many rural and remote regions often face severe crop damage and livestock losses because diseases and pest attacks are identified too late. Limited access to agricultural experts, veterinarians, and diagnostic tools forces farmers to rely on manual observation or delayed reporting, which frequently leads to misdiagnosis and uncontrolled outbreaks. There is a need for an AI-powered agricultural intelligence platform that can analyze crop and livestock images captured from smartphones using computer vision models to detect diseases, pest infestations, or abnormal symptoms at an early stage. By leveraging machine learning and image recognition, the system can instantly generate diagnostic insights and recommend preventive actions to farmers. The platform can also use geographic and historical data to identify patterns, predict potential outbreaks, and support faster reporting to national monitoring systems such as the National Digital Livestock Mission (NDLM). Through multilingual AI-based assistance and continuous analysis of farm health data, the system can provide farmers with accessible guidance, early warnings, and data-driven recommendations to improve crop protection, livestock health, and long-term agricultural productivity.",
                    features: [
                       "You Can add your Own ideas"
                    ],
                    set: "Set 1"
                },
                {
                    id: "5",
                    name: "Campus-GPT: AI-Powered Institutional Intelligence & Admission Concierge",
                    slots: 3,
                    problemStatement: "During admission periods, technical institutes receive a large number of inquiries from students and parents regarding eligibility criteria, fee structures, scholarships, courses, and campus facilities. Most of these queries are currently handled through emails, phone calls, or manual responses from administrative staff, leading to delays, repetitive workloads, and inconsistent information delivery. Students often struggle to quickly obtain accurate and updated information, especially when comparing colleges or understanding admission requirements. There is a need for an AI-powered virtual assistant that can use natural language processing to understand user questions, retrieve relevant information from an integrated institutional knowledge base, and provide instant, accurate responses. By leveraging AI-based recommendation and conversational technologies, the system can also guide students by suggesting suitable colleges or branches based on their profiles, support voice-based interaction, and operate across multiple digital platforms. Additionally, the platform can analyze user queries to identify common concerns, assist administrators in improving information services, and intelligently redirect complex inquiries to the appropriate departments when human assistance is required.",
                    features: [
                         "You Can add your Own ideas"
                    ],
                    set: "Set 1"
                },
                {
                    id: "6",
                    name: "NeuroTraffic: AI-Driven Digital Twin for Urban Congestion",
                    slots: 3,
                   problemStatement: "Traditional traffic signal systems operate on fixed timers that do not adapt to real-time traffic conditions, often leading to unnecessary vehicle waiting, congestion, and increased fuel consumption at busy intersections. Testing improved traffic signal strategies in real-world environments is difficult and expensive because it requires changes to physical infrastructure and may disrupt existing traffic flow. There is a need for an AI-powered traffic optimization platform that can simulate realistic urban traffic environments and intelligently learn better signal control strategies. By applying deep reinforcement learning and machine learning techniques, the system can analyze vehicle movement patterns, traffic density, and waiting times to automatically determine optimal signal timings. Using a digital twin simulation environment and AI-based traffic flow analysis, the platform can model intersections, study congestion behavior, and evaluate improvements in travel time, emissions, and fuel efficiency. Such an AI-driven simulation system would enable researchers and urban planners to safely experiment with different traffic scenarios, predict the impact of traffic events such as accidents or peak-hour surges, and design smarter signal control strategies before deploying them in real-world cities.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"
                },
                {
                    id: "7",
                    name: "TalentMatch AI: Neural Candidate Ranking & Explainable Recruitment",
                    slots: 3,
                    problemStatement: "Recruiters often receive a large number of applications for each job opening, making it difficult to evaluate candidates efficiently and fairly. Most organizations still rely on manual screening or simple keyword-based filtering systems that fail to capture the true context of a candidate’s skills, experience, and career progression. This leads to inconsistent shortlisting, overlooked talent, and potential bias in the recruitment process. There is a need for an AI-powered recruitment platform that can analyze unstructured resume data using natural language processing and machine learning to understand candidate skill profiles, work experience, and career trajectories. The system should intelligently compare candidate profiles with evolving job requirements, rank applicants using multiple evaluation factors, and identify the most suitable candidates for different roles. By using explainable AI techniques, the platform can also provide transparent reasoning behind each recommendation, dynamically update candidate rankings as hiring priorities change, and support fair, data-driven decision-making across the entire talent pool.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"
                },
                {
                    id: "8",
                    name: "DeepShield AI: Intelligent Deepfake Detection & Media Authenticity Analyzer",
                    slots: 3,
                    problemStatement: "The rapid advancement of generative AI technologies has made it increasingly difficult to distinguish authentic media from manipulated images and videos. Deepfakes are now widely used for misinformation, identity fraud, and digital manipulation, posing serious risks to public trust and online safety. Manual verification methods are slow, error-prone, and ineffective when analyzing large volumes of media content. There is a need for an AI-powered media verification system that uses deep learning and computer vision techniques to automatically analyze images and videos for signs of manipulation. By examining visual artifacts, facial inconsistencies, and temporal patterns across video frames, the system can identify synthetic or altered media with high accuracy. Through advanced AI-based image and video analysis, the platform can highlight suspicious regions, evaluate facial and motion consistency, and generate confidence scores to verify authenticity. Such a system would enable real-time detection through automated analysis and provide investigators, moderators, and platforms with reliable tools to upload media, review verification results, and monitor potentially manipulated content at scale.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"

                },
                {
                    id: "9",
                    name: "LearnAdapt AI: Intelligent Personalized Learning & Performance Analytics Platform",
                    slots: 3,
                    problemStatement: "Most education systems follow a one-size-fits-all teaching model where every student receives the same learning content, pace, and assessment structure. However, students differ significantly in their learning speed, strengths, interests, and knowledge gaps. This uniform approach often causes some learners to struggle with complex topics while others are not challenged enough, resulting in reduced engagement and ineffective learning outcomes. There is a need for an AI-powered adaptive learning platform that can analyze student performance data, learning behavior, and engagement patterns using machine learning techniques. By continuously interpreting this data, the system can personalize the learning experience for each student, generate customized study plans, recommend suitable learning resources, and identify weak areas that require additional practice. Through predictive analytics and intelligent recommendation models, the platform can also anticipate potential academic risks and adapt learning paths dynamically as new performance data becomes available. Such an AI-driven system would support both students and educators by enabling more personalized learning strategies, improving engagement, and helping achieve better academic outcomes.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"

                },
                {
                    id: "10",
                    name: "TruthSense AI: Multimodal Deception Detection & Behavioral Analysis System",
                    slots: 3,
                    problemStatement: "In interviews, investigations, and online assessments, determining whether a person is being truthful can be difficult when relying solely on human observation. Evaluators often depend on subjective interpretation of facial expressions, tone of voice, and behavioral cues, which can lead to inconsistent or biased judgments. Subtle indicators such as micro-expressions, stress in voice patterns, or involuntary facial movements are often too brief or complex for humans to reliably detect. There is a need for an AI-powered behavioral analysis system that can automatically examine video and audio signals using computer vision and speech analysis techniques. By applying machine learning models to detect facial expressions, micro-expressions, voice tone variations, pitch changes, and speech dynamics, the system can identify behavioral patterns associated with stress or potential deception. The platform can generate AI-driven insights with confidence scores, highlight the key cues that influenced the analysis, and provide evaluators with a structured interface to review recordings and behavioral indicators. Such an AI-based system would support more objective, data-driven decision-making during interviews, investigations, and remote assessments.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"

                },
                {
                    id: "11",
                    name: "CareerMatch AI: Intelligent Resume Analyzer & Smart Job Recommendation Platform",
                    slots: 3,
                    problemStatement: "Recruiters often receive thousands of applications for a single job opening, making it difficult to quickly identify the most suitable candidates. At the same time, many job seekers apply to roles without clearly understanding whether their skills, experience, and qualifications align with job requirements. Traditional screening methods rely heavily on manual review or simple keyword-based filtering, which can overlook capable candidates and create inefficiencies in the hiring process. There is a need for an AI-powered recruitment platform that can automatically extract and structure information from resumes using natural language processing and machine learning techniques. The system should intelligently analyze candidate skills, experience, and qualifications, compare them with job descriptions, and identify strong matches based on contextual understanding rather than simple keywords. By using AI-driven analysis, the platform can also highlight missing skills, provide personalized career improvement suggestions, and explain why certain job roles are recommended. As candidate profiles evolve with new skills or experience, the system can continuously update recommendations and rankings, helping recruiters shortlist candidates more efficiently while guiding job seekers toward suitable career opportunities and skill development paths.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"
                },
                {
                    id: "12",
                    name: "ScholarMatch AI: Intelligent Scholarship Discovery & Eligibility Analyzer",
                    slots: 3,
                    problemStatement: "Many students miss valuable scholarship opportunities because information about scholarships is scattered across multiple platforms and eligibility criteria are often complex or unclear. Students frequently struggle to determine which scholarships match their academic background, achievements, field of study, or financial need, often spending significant time searching through different sources or missing important deadlines. There is a need for an AI-powered scholarship discovery and recommendation platform that can analyze student profiles using machine learning and natural language processing techniques. By examining academic performance, interests, achievements, and financial background, the system can automatically identify and recommend suitable scholarship opportunities that align with a student's qualifications. The AI system can also evaluate eligibility requirements, estimate how well a student qualifies for each scholarship, and provide personalized guidance throughout the application process. By continuously learning from updated student profiles and newly available scholarship programs, the platform can dynamically update recommendations and help students efficiently discover, prepare for, and apply to financial support opportunities for their education.",
                    features: [
                        "You Can add your Own ideas"
                    ],
                    set: "Set 1"

                },
                {
                    id: "13",
                    name: "NarrativeAI: Adaptive Interactive Storytelling Platform",
                    slots: 3,
                    problemStatement: "Most digital storytelling platforms generate standalone stories that do not adapt to individual readers or remember past interactions. As a result, characters often lose consistency, storylines reset between sessions, and the reading experience becomes repetitive and impersonal. Readers also have limited control over how stories evolve, and existing systems rarely learn from user preferences, reading levels, or previous choices. There is a need for an AI-powered adaptive storytelling platform that can use generative AI and machine learning to understand reader profiles and dynamically create personalized narratives. By analyzing user preferences, interaction patterns, and past story decisions, the system can generate evolving storylines while maintaining continuity of characters, events, and plot across multiple sessions. The AI system can also adjust narrative tone, complexity, and pacing according to the reader’s age, comprehension level, and engagement patterns. Through continuous learning from reader interactions and story progression data, the platform can deliver immersive, interactive storytelling experiences where readers influence how stories develop while ensuring consistent characters, coherent plots, and personalized reading journeys.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 1"
                },
                {
                    id: "14",
                    name: "TravelSense AI: Adaptive Smart Travel Companion & Real-Time Trip Optimizer",
                    slots: 3,
                    problemStatement: "Travelers often face unexpected challenges during trips such as traffic congestion, weather disruptions, transport delays, or difficulty navigating unfamiliar locations. Most travel planning applications generate static itineraries that do not adapt when real-world conditions change, leaving users without timely updates or alternative plans. This can cause missed reservations, wasted travel time, and a stressful travel experience. There is a need for an AI-powered intelligent travel companion platform that can analyze traveler preferences, monitor trip progress using location data, and process real-time information such as traffic conditions, weather updates, and transportation delays. By applying machine learning and data analysis techniques, the system can dynamically adjust travel itineraries, recommend alternative routes or nearby activities, and provide timely alerts to help travelers respond to changing situations. The AI system can also learn from user travel history and preferences to deliver personalized recommendations, assist users through conversational interactions, and continuously optimize travel plans during the journey. Such an AI-driven platform would help travelers navigate unfamiliar environments more efficiently while ensuring a smoother, more adaptive, and personalized travel experience.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 2"
                },
                {
                    id: "15",
                    name: "SpeedPrep AI: Company-Specific Technical Quiz & Interview Practice Platform",
                    slots: 3,
                    problemStatement: "Students preparing for technical interviews often struggle to find practice questions that accurately reflect the interview patterns of specific companies. Most preparation platforms provide generic question sets that do not align with the topics, difficulty levels, and formats commonly used by particular organizations, forcing candidates to spend significant time searching across multiple resources. There is a need for an AI-powered interview preparation platform that can analyze company-specific interview patterns, role requirements, and historical question trends to generate targeted practice content. By using machine learning and data-driven analysis, the system can recommend personalized quizzes and coding challenges based on a user's selected company, role, and current skill level. The AI system can also evaluate user performance, identify strengths and weak areas, adapt question difficulty, and continuously update practice recommendations to improve preparation efficiency. Such an intelligent platform would provide a structured and personalized preparation experience while helping students simulate real interview scenarios and track their progress over time.",
                    features:[
                        "You can add your Own ideas"
                    ],  
                    set: "Set 2"
                },
                {
                    id: "16",
                    name: "FoodBridge: Smart Food Waste Redistribution & Volunteer Coordination Platform",
                    slots: 3,
                    problemStatement: "A significant amount of edible food is wasted daily by restaurants, hotels, and event organizers, while many communities continue to face food shortages. The absence of an efficient coordination system between food donors, NGOs, and volunteers often leads to delays, logistical difficulties, and missed opportunities to redistribute surplus food before it expires. There is a need for an AI-powered food redistribution platform that can intelligently connect donors, NGOs, and volunteers by analyzing factors such as location, food quantity, pickup urgency, and volunteer availability. Using machine learning and data-driven analysis, the system can automatically match surplus food listings with the most suitable nearby organizations or volunteers to ensure timely collection and distribution. The AI system can also predict pickup priorities based on food expiry times, optimize delivery routes, and provide real-time notifications to participants when donations become available. By continuously analyzing donation patterns, distribution efficiency, and community demand, the platform can improve coordination, reduce food waste, and ensure that surplus food reaches communities in need quickly and safely.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 2"
                },
                {
                    id: "17",
                    name: "SmartFlow AI: Intelligent Traffic & Parking Management Platform",
                    slots: 3,
                    problemStatement: "Urban areas are experiencing increasing traffic congestion and inefficient use of parking spaces due to limited real-time monitoring and lack of intelligent data-driven management systems. City authorities often lack accurate insights into vehicle density, congestion hotspots, peak traffic hours, and parking availability, making it difficult to manage urban mobility effectively. This results in longer travel times, higher fuel consumption, and increased environmental pollution. There is a need for an AI-powered smart traffic and parking management platform that can collect and analyze real-time traffic data from cameras, GPS sources, and sensors. Using machine learning and computer vision techniques, the system can study vehicle movement patterns, detect congestion-prone areas, and predict traffic conditions in advance. The AI system can also analyze parking occupancy data to identify available spaces and guide drivers to nearby vacant parking slots through intelligent recommendations. By continuously learning from traffic flow data and urban mobility patterns, the platform can recommend optimized signal timings, generate congestion alerts, and provide advanced analytics dashboards that help city authorities make informed decisions for efficient traffic control, improved parking utilization, and better long-term urban planning.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 2"
                },

                {
                    id: "18",
                    name: "DataVault Secure: Privacy-First Personal Document Control Platform",
                    slots: 3,
                    problemStatement: "Individuals often store important personal documents such as identity proofs, certificates, and financial records across multiple digital platforms, making it difficult to manage access and maintain privacy. This fragmented storage approach increases the risk of unauthorized access, data leaks, and misuse of sensitive information. There is a need for an AI-powered privacy-focused digital vault that can securely store and organize personal documents while intelligently managing access and security. By using AI-driven data analysis and security monitoring, the system can classify documents automatically, detect unusual access patterns, and provide smart recommendations for secure sharing and permission management. The platform should enable users to upload and categorize documents securely with strong encryption, share them through controlled and temporary access links, and define role-based permissions with identity verification before access is granted. The AI system can also analyze usage patterns, maintain detailed access logs, detect potential security risks, and help users manage document sharing more safely. Through continuous monitoring and intelligent privacy controls, the platform can provide users with clear visibility into document usage, sharing status, and overall data protection through a centralized and secure dashboard.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 2"
                },
                {
                    id: "19",
                    name: "EcoCollect: Digital Waste Management Coordination & Recycling Platform",
                    slots: 3,
                    problemStatement: "Urban waste management systems often suffer from poor coordination between citizens, waste collectors, and recycling centers. Waste collection requests are frequently handled through manual processes or disconnected systems, making it difficult to track pickups, manage schedules, and monitor recycling activities efficiently. As cities grow, these limitations lead to missed pickups, inefficient vehicle usage, and lack of transparency in waste handling processes. There is a need for a centralized digital waste management platform that enables citizens to report waste collection requests, allows waste collectors to schedule and manage pickups, and helps recycling facilities track incoming waste categories. The system should support location-based request tracking, collection scheduling, route management, and real-time status updates for citizens and collectors. It should also provide dashboards and analytics for municipal authorities to monitor waste collection operations, track recycling performance, and improve overall waste management efficiency in urban areas.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 2"
                },
                {
                    id: "20",
                    name: "RescueLink: Real-Time Emergency Resource Locator Platform",
                    slots: 3,
                    problemStatement: "During emergencies such as road accidents, medical crises, or natural disasters, people often struggle to quickly locate nearby hospitals, ambulances, blood donors, and other critical services. The absence of a centralized platform for accessing verified emergency resources can cause delays in response and increase risks to human lives. There is a need for a real-time emergency assistance platform that can use location data to instantly identify nearby hospitals, blood banks, ambulances, and police stations through an interactive map interface. The system should allow users to send SOS requests with their live location, notify nearby volunteers or responders, and provide verified emergency contact information. It should also track the availability of emergency resources, support real-time updates from hospitals or volunteers, and offer an administrative dashboard to monitor emergency requests and coordinate responses efficiently. Such a platform can help improve communication and ensure faster and more organized emergency assistance.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 2"

                },
                {
                    id: "21",
                    name: "Unified Academic-Extracurricular Integration Ecosystem",
                    slots: 3,
                    problemStatement: "In many colleges, academic activities and extracurricular events are managed using separate systems or manual processes. Event registrations, attendance tracking, and club activities are often handled through spreadsheets or different platforms, making it difficult for institutions to maintain accurate records of student participation. This fragmented approach leads to problems such as proxy attendance, delayed updates, data inconsistencies, and limited visibility into how extracurricular involvement contributes to a student's academic development. There is a need for a unified digital campus activity management platform that can centrally manage events, allow students to register online, provide real-time updates about event availability, and securely track attendance. The system should support role-based access for administrators, faculty, students, and event volunteers, enabling efficient event creation, registration management, attendance verification, and participation tracking. It should also allow institutions to link verified event participation with academic credits or recognition while automatically generating certificates and maintaining transparent records of student involvement in campus activities.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 2"
                },
                {
                    id: "22",
                    name: "ReviewGuard AI: Fake Product Review Detection & Trust Analysis System",
                    slots: 3,
                    problemStatement: "Online product reviews strongly influence customer purchasing decisions, but many e-commerce platforms suffer from the presence of fake or manipulated reviews that are created to artificially increase product ratings or damage competitors. These deceptive reviews reduce consumer trust and make it difficult for buyers to identify genuine feedback. Manual moderation is not scalable when large volumes of reviews are submitted every day. There is a need for an AI-powered review authenticity detection system that can automatically analyze review text and identify deceptive patterns. By using natural language processing and machine learning techniques, the system can examine linguistic style, sentiment patterns, and contextual cues to distinguish genuine reviews from manipulated ones. The AI model should assign authenticity scores, highlight suspicious indicators that influenced the prediction, and provide insights into review credibility. Such a system can help e-commerce platforms filter deceptive reviews, improve transparency, and support more reliable decision-making for customers.",
                    features:[
                        "You can add your Own ideas"
                    ],
                    set: "Set 2"

                },
                {
                    id: "23",
                    name: "MuseBot: AI Chatbot-Based Smart Ticketing & Visitor Management System",
                    slots: 3,
                    problemStatement: "Many museums still rely on manual ticket booking systems where visitors must stand in long queues to purchase entry tickets, especially during weekends, holidays, or special exhibitions. This often leads to delays, overcrowding, booking errors, and an overall poor visitor experience. Traditional ticketing systems also make it difficult for visitors to quickly obtain information about exhibitions, timings, and ticket availability. There is a need for an AI-powered conversational ticketing platform that allows visitors to interact with a chatbot to book tickets, check availability, and receive instant answers to common queries. Using natural language processing, the system can understand visitor requests, guide users through the booking process, and provide multilingual assistance. The platform should also manage real-time ticket availability, support secure online payments, and generate digital tickets for quick entry verification. By automating visitor interactions and ticket management, the system can improve operational efficiency for museums while providing a faster and more convenient experience for visitors.",
                    features:[
                        "You can add your Own ideas"
                    ],
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

    // Broadcast initial status immediately
    checkRegistrationStatus();

    // Periodically check registration status (reduced from 10s to 2s for near real-time updates)
    setInterval(checkRegistrationStatus, 2000);
};

startServer();