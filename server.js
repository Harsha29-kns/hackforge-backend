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
                    problemStatement: "The current skill ecosystem struggles with fragmented evaluation methods that fail to provide high-quality, standardized assessments across pen-paper, MCQ, and viva formats. Traditional tools are often inaccessible to Persons with Disabilities (PWD) and lack the flexibility for blended online/offline modes in underserved areas. There is a critical need for an AI-powered software suite that ensures inclusivity, adapts to individual learner levels, and maintains rigorous quality assurance across schools, ITIs, and vocational training centers.",
                    features: [
                        "Holistic Evaluation Engine supporting digitized pen-paper analysis, automated MCQ grading, and AI-driven descriptive exam scoring.",
                        "PWD-First Accessibility Suite featuring integrated Voice-to-Text, Text-to-Speech, and customizable alternative input methods for inclusive testing.",
                        "Tri-Mode Deployment Architecture enabling seamless assessment delivery across Online, Offline, and Blended environments.",
                        "Adaptive AI Personalization that dynamically adjusts question complexity and formats based on real-time candidate performance metrics.",
                        "Virtual Viva Voce Assistant using Natural Language Processing (NLP) to conduct and evaluate oral examinations and practical understanding.",
                        "Real-Time Analytics Dashboard providing educators and candidates with deep-dive insights into strengths and personalized learning gaps.",
                        "Ecosystem Standardization Framework to ensure consistent evaluation rigor and quality benchmarks across different geographic regions.",
                        "Enterprise-Grade Data Security implementing robust encryption and privacy protocols to protect sensitive candidate profiles and results."
                    ],
                    set: "Set 1"
                },
                {
                    id: "2",
                    name: "AI-Powered Video Understanding & Learning Assistant",
                    slots: 3,
                    problemStatement: "Students and professionals consume large amounts of educational video content on platforms like YouTube, but extracting useful information from long videos is time-consuming and inefficient. Users often struggle to quickly understand key concepts, review important sections, or ask questions about the content. There is a need for an intelligent system that can automatically analyze videos, generate summaries, extract key insights, and enable interactive question-answering to improve learning efficiency.",
                    features: [
                        "Support for uploading YouTube links or local video files to analyze educational content.",
                        "Automatic speech-to-text transcription using AI to convert video audio into searchable text.",
                        "AI-powered video summarization generating short summaries, key points, and structured notes.",
                        "Interactive 'Chat with Video' feature allowing users to ask questions about the video content.",
                        "Quiz generator that creates multiple-choice questions based on the video transcript to test understanding.",
                        "Smart semantic search over video transcripts using vector embeddings to retrieve relevant segments quickly."
                    ],
                    set: "Set 1"
                },
                {
                    id: "3",
                    name: "OptiTask AI: Neural Workload Balancing & Cognitive Task Allocation",
                    slots: 3,
                    problemStatement: "Traditional task assignment relies on static availability or historical bias, often ignoring the interplay between task complexity, fluctuating employee performance trends, and real-time burnout risks. This leads to uneven skill utilization and systemic inefficiencies where high-performers are over-leveraged while specialized skills remain dormant. A neural-driven allocation engine is required to autonomously optimize team productivity by dynamically matching task requirements to the most suitable cognitive profiles while maintaining sustainable workload equilibrium.",
                    features: [
                        "Predictive Suitability Scoring using Deep Learning to analyze employee skill proficiency, historical completion velocity, and task-specific complexity.",
                        "Dynamic Multi-Factor Optimization (MFO) that balances immediate priority deadlines against long-term skill development and individual workload capacity.",
                        "Burnout Prevention Module that monitors 'cognitive load' and alerts managers when task density exceeds healthy performance thresholds.",
                        "Explainable AI (XAI) Recommendation Engine providing transparent justifications for every assignment based on competency-to-task alignment.",
                        "Intelligent Manager Command Center for real-time scenario modeling, allowing 'what-if' adjustments to project priorities and team structures.",
                        "Employee Empowerment Portal displaying personalized workload heatmaps, priority-sorted queues, and AI-suggested skill growth paths.",
                        "Automated Skill Gap Analytics that identifies team-wide deficiencies based on task requirements that frequently lack high-suitability matches.",
                        "Asynchronous Synchronization Logic to ensure allocation recommendations adapt instantly as tasks are completed or new high-priority tickets enter the system."
                    ],
                    set: "Set 1"

                },
                {
                    id: "4",
                    name: "AgriGuard AI: Computer Vision & Predictive Analytics for Farm Health",
                    slots: 3,
                    problemStatement: "Farmers in remote regions face catastrophic crop and livestock losses due to delayed disease diagnosis and limited access to expert veterinary or agricultural services. Manual reporting is slow, and symptoms are often misidentified, leading to widespread outbreaks. A software-driven AI portal is required to provide instant, field-level diagnostics and automated reporting to bridge the gap between farmers and centralized surveillance systems like the National Digital Livestock Mission (NDLM).",
                    features: [
                        "Edge-based Computer Vision models for real-time identification of crop pests and livestock skin/behavioral diseases via smartphone imagery.",
                        "Automated Diagnostic Reporting system that generates suspected condition analysis paired with immediate preventive action protocols.",
                        "NDLM Integration module to facilitate seamless data synchronization and official reporting to government surveillance frameworks.",
                        "AI-Driven Alerts and routing system that instantly notifies the nearest veterinarians or agricultural officers of high-risk symptoms.",
                        "Predictive Outbreak Mapping using anonymized geographic data to visualize disease spread and provide early warnings to the farming community.",
                        "Actionable Advice Engine providing customized treatment suggestions and sustainable management practices based on AI analysis.",
                        "Multilingual Natural Language interface to support symptom description and advice delivery in diverse regional languages.",
                        "Historical Health Dashboard for farmers to track recurring issues and monitor long-term productivity trends on their individual holdings."
                    ],
                    set: "Set 1"
                },
                {
                    id: "5",
                    name: "Campus-GPT: AI-Powered Institutional Intelligence & Admission Concierge",
                    slots: 3,
                    problemStatement: "Technical institutes face a massive surge in stakeholder inquiries during admission cycles regarding eligibility, fee structures, and campus facilities. Currently, students and parents must contact colleges individually via email or phone, creating a cumbersome manual workload for staff and delayed responses for applicants. A centralized, AI-driven virtual assistant is needed to provide 24/7 instant information retrieval, automating the distribution of institutional data and reducing the administrative burden on campus personnel.",
                    features: [
                        "Natural Language Processing (NLP) engine capable of understanding complex queries about admission criteria, scholarships, and curriculum updates.",
                        "Integrated Institutional Knowledge Base that centralizes data from multiple departments into a single, searchable conversational interface.",
                        "Voice-Based Assistance support for English, with modular architecture for future multi-lingual (Hindi/Regional) expansion.",
                        "Smart Recommendation System that suggests colleges and branches based on a student's profile and historical cutoff trends.",
                        "Live Dashboard for Administrators to identify high-frequency concerns and optimize institutional services based on user interaction data.",
                        "Seamless Handover Logic that automatically escalates complex, non-standard inquiries to relevant department faculty for human intervention.",
                        "Omnichannel Accessibility designed to be deployed across web portals and common communication platforms for maximum reach.",
                        "Real-time FAQ Automation that dynamically updates its responses as faculty modify event or academic details in the backend."
                    ],
                    set: "Set 1"
                },
                {
                    id: "6",
                    name: "NeuroTraffic: AI-Driven Digital Twin for Urban Congestion",
                    slots: 3,
                    problemStatement: "Traditional static traffic timers are 'blind' to real-time demand, causing unnecessary idling and gridlock. Building physical infrastructure to test new timing logic is expensive and risky. There is a critical need for a high-fidelity software simulation platform that uses Deep Reinforcement Learning to autonomously discover optimal signaling strategies for complex, multi-directional intersections.",
                    features: [
                        "Deep Q-Learning (DQN) agent that 'learns' optimal green-light duration by minimizing cumulative vehicle wait times.",
                        "Integrated Traffic Digital Twin using SUMO (Simulation of Urban MObility) to model realistic vehicle physics and driver behavior.",
                        "Computer Vision preprocessing module to simulate 'virtual cameras' that count and categorize vehicles (emergency vs. private).",
                        "Real-time performance telemetry tracking CO2 emission reduction and fuel efficiency gains compared to baseline static timers.",
                        "Scenario-based stress testing for 'Edge Cases' like accidents, road closures, or sudden peak-hour surges.",
                        "Web-based Analytics Portal providing heatmaps and throughput data for urban planning decision support."
                    ],
                    set: "Set 1"
                },
                {
                    id: "7",
                    name: "TalentMatch AI: Neural Candidate Ranking & Explainable Recruitment",
                    slots: 3,
                    problemStatement: "Recruiters are overwhelmed by high-volume applications, relying on rigid, manual screening that fails to capture the nuance of diverse candidate backgrounds. Traditional 'keyword-matching' ignores the context of experience and skill proficiency, leading to inconsistent shortlisting and hidden bias. An AI-driven recruitment engine is required to autonomously map candidate trajectories against dynamic role requirements, providing transparent, multi-factor rankings that evolve as hiring priorities shift.",
                    features: [
                        "Neural Embedding Engine to transform unstructured resume data (skills, experience, timelines) into a standardized talent vector space.",
                        "Dynamic Requirement Weighting allowing recruiters to configure and update AI priority levels for specific technical or soft skills in real-time.",
                        "Cross-Role Compatibility Analysis to automatically evaluate a single candidate profile against multiple open positions simultaneously.",
                        "Explainable AI (XAI) Scoring that generates natural language justifications for every ranking decision, highlighting specific alignment factors.",
                        "Adaptive Shortlisting Dashboard featuring visual candidate-role heatmaps and real-time 'what-if' analysis for modified criteria.",
                        "Automated Gap Analysis identifying missing competencies and suggesting adjacent roles where a candidate's profile may be a stronger fit.",
                        "Seamless Data Synchronization enabling instant re-ranking of the entire talent pool as new candidate data or role definitions are added.",
                        "Bias-Mitigation Framework using anonymized data processing to ensure fair evaluation based strictly on merit and objective competencies."
                    ],
                    set: "Set 1"
                },
                {
                    id: "8",
                    name: "DeepShield AI: Intelligent Deepfake Detection & Media Authenticity Analyzer",
                    slots: 3,
                    problemStatement: "The rapid growth of AI-generated media has made it increasingly difficult to distinguish authentic videos and images from manipulated deepfakes. These deepfakes are widely used for misinformation, identity fraud, and social manipulation, posing serious risks to digital trust and public safety. Manual verification is unreliable and time-consuming, especially when dealing with large volumes of media. An AI-powered system is required to automatically analyze visual inconsistencies, facial anomalies, and temporal patterns to accurately detect deepfake content and provide reliable authenticity verification.",
                    features: [
                        "Deepfake Image Detection using Convolutional Neural Networks (CNNs) to identify pixel-level artifacts and facial manipulation patterns in images.",
                        "Video Deepfake Detection through Temporal Frame Analysis to detect unnatural transitions, blinking inconsistencies, and motion irregularities across video frames.",
                        "Vision Transformer-Based Media Analysis for high-accuracy detection of subtle synthetic patterns generated by modern deepfake models.",
                        "Face Consistency Verification that analyzes facial landmarks, lighting direction, skin texture, and head pose consistency across frames.",
                        "Multi-Modal Forgery Detection combining spatial and temporal analysis for improved accuracy in both images and videos.",
                        "Explainable AI Detection Reports that highlight manipulated regions and provide confidence scores for authenticity verification.",
                        "Real-Time Media Verification API allowing websites, social platforms, and applications to automatically scan uploaded media for deepfake content.",
                        "Interactive Dashboard for investigators and moderators to upload media, visualize detection results, and track suspicious content patterns."
                    ],
                    set: "Set 1"

                },
                {
                    id: "9",
                    name: "LearnAdapt AI: Intelligent Personalized Learning & Performance Analytics Platform",
                    slots: 3,
                    problemStatement: "Traditional education systems follow a uniform teaching approach where all students receive the same content and pace of instruction. However, students have different learning speeds, strengths, and knowledge gaps. This often leads to some students struggling to keep up while others are not sufficiently challenged. An AI-powered learning platform is required to analyze student performance, learning patterns, and engagement behavior to generate personalized study plans, recommend suitable learning resources, and continuously adapt the learning path for improved academic outcomes.",
                    features: [
                        "Student Performance Analysis using Machine Learning models to evaluate quiz scores, assignment results, and learning progress over time.",
                        "Personalized Study Plan Generator that dynamically recommends topics, exercises, and revision schedules based on individual learning gaps.",
                        "Adaptive Content Recommendation Engine suggesting videos, notes, and practice problems tailored to each student's learning level.",
                        "Learning Behavior Tracking that monitors time spent on topics, interaction patterns, and difficulty levels to understand student engagement.",
                        "Predictive Performance Analytics to identify students at risk of falling behind and recommend targeted interventions.",
                        "Explainable AI Insights providing clear explanations on why certain topics or materials are recommended for each learner.",
                        "Teacher Analytics Dashboard enabling educators to track student progress, identify weak areas, and monitor class-level performance trends.",
                        "Continuous Learning Path Optimization where the AI updates recommendations as new student performance data becomes available."
                    ],
                    set: "Set 1"

                },
                {
                    id: "10",
                    name: "TruthSense AI: Multimodal Deception Detection & Behavioral Analysis System",
                    slots: 3,
                    problemStatement: "During interviews, investigations, and online assessments, it is often difficult to determine whether a person is being truthful. Human judgment alone can be subjective and prone to bias, especially when subtle behavioral cues are involved. An AI-powered lie detection system is required to analyze facial expressions, micro-expressions, and vocal tone patterns to identify potential signs of deception. By combining computer vision and speech emotion recognition, the system can provide behavioral insights and confidence scores that help evaluators make more informed decisions.",
                    features: [
                        "Facial Expression Analysis using computer vision models to detect subtle changes in facial muscles associated with stress or deception.",
                        "Micro-Expression Detection capable of identifying extremely brief involuntary expressions that may reveal concealed emotions.",
                        "Speech Emotion Recognition analyzing voice tone, pitch variation, speech rate, and pauses to identify emotional stress patterns.",
                        "Multimodal Behavioral Fusion combining facial and audio signals to improve accuracy in deception detection.",
                        "Real-Time Interview Monitoring allowing live analysis of video interviews with instant behavioral insights.",
                        "AI Confidence Scoring that provides a probability score indicating potential deception based on multiple behavioral indicators.",
                        "Explainable Behavioral Reports highlighting specific facial cues and vocal features that influenced the system's assessment.",
                        "Interview Analytics Dashboard enabling investigators or recruiters to review recordings, behavioral patterns, and AI-generated insights."
                    ],
                    set: "Set 1"

                },
                {
                    id: "11",
                    name: "CareerMatch AI: Intelligent Resume Analyzer & Smart Job Recommendation Platform",
                    slots: 3,
                    problemStatement: "Recruiters often receive thousands of job applications, making it difficult to quickly identify the most suitable candidates. At the same time, many job seekers apply for positions without fully understanding whether their skills match the job requirements. Traditional resume screening methods rely on manual filtering or simple keyword matching, which often overlooks capable candidates or misclassifies profiles. An AI-powered resume analysis and job matching platform is required to intelligently extract skills from resumes, analyze candidate profiles, match them with relevant job opportunities, and provide personalized recommendations to help users improve their employability.",
                    features: [
                        "AI Resume Upload & Parsing System that automatically extracts structured information such as skills, education, experience, and certifications from uploaded resumes.",
                        "NLP-Based Skill Extraction Engine that identifies technical and soft skills from unstructured resume text using natural language processing techniques.",
                        "Semantic Job Matching System using similarity models to compare candidate skill vectors with job descriptions and rank the most relevant opportunities.",
                        "Skill Gap Analysis that highlights missing or weak skills required for targeted job roles and provides a readiness score for each position.",
                        "Personalized Skill Improvement Suggestions recommending courses, certifications, or learning paths to help candidates bridge identified skill gaps.",
                        "Explainable AI Matching Reports showing why a particular job was recommended and which skills contributed to the match score.",
                        "Multi-Role Compatibility Analyzer that evaluates a single resume against multiple job roles and industries simultaneously.",
                        "Recruiter Dashboard for automated candidate ranking, resume filtering, and shortlisting based on configurable hiring criteria.",
                        "Real-Time Resume Feedback that analyzes resume quality and suggests improvements in formatting, keywords, and content structure.",
                        "Career Path Prediction Engine that analyzes a candidate's experience trajectory and recommends potential future job roles.",
                        "AI Interview Preparation Assistant generating personalized interview questions based on the candidate's resume and targeted job role.",
                        "Continuous Profile Learning where the system updates job recommendations as the user adds new skills, certifications, or experience."
                    ],
                    set: "Set 1"
                },
                {
                    id: "12",
                    name: "ScholarMatch AI: Intelligent Scholarship Discovery & Eligibility Analyzer",
                    slots: 3,
                    problemStatement: "Many students miss valuable scholarship opportunities because they are unaware of available programs or unsure about their eligibility. Scholarship information is often scattered across multiple websites, making it difficult for students to discover opportunities that match their academic profile, achievements, and financial background. An AI-powered scholarship recommendation platform is required to analyze student profiles, evaluate eligibility criteria, and intelligently recommend suitable scholarships, helping students access financial support for their education.",
                    features: [
                        "AI-Powered Student Profile Analyzer that evaluates academic performance, field of study, extracurricular activities, and financial background.",
                        "Intelligent Scholarship Matching Engine that recommends scholarships based on eligibility criteria, qualifications, and career goals.",
                        "Eligibility Scoring System that calculates a probability score indicating how well a student qualifies for each scholarship.",
                        "Automated Scholarship Discovery that continuously scans verified scholarship databases and adds new opportunities to the platform.",
                        "Personalized Scholarship Recommendations that adapt as students update their profiles, grades, or achievements.",
                        "Application Deadline Tracker with smart reminders to ensure students do not miss important submission dates.",
                        "Document Preparation Assistant guiding students on required documents such as statements of purpose, recommendation letters, and transcripts.",
                        "AI-Based Essay Assistance that suggests improvements for scholarship essays based on successful application patterns.",
                        "Scholarship Comparison Dashboard enabling students to compare benefits, eligibility criteria, deadlines, and application difficulty.",
                        "Explainable AI Insights showing why a scholarship was recommended and what requirements the student already meets.",
                        "Admin Portal for educational institutions and organizations to publish and manage scholarship opportunities.",
                        "Analytics Dashboard providing insights into popular scholarships, student eligibility trends, and application success rates."
                    ],
                    set: "Set 1"

                },
                {
                    id: "13",
                    name: "NarrativeAI: Adaptive Interactive Storytelling Platform",
                    slots: 3,
                    problemStatement: "Most digital storytelling platforms generate isolated stories that do not adapt to individual readers or remember previous interactions. As a result, characters often lose consistency, storylines reset between sessions, and the overall experience feels repetitive and impersonal. Readers cannot influence how the story evolves, and the system fails to learn from user preferences or reading behavior. An adaptive AI storytelling platform is required to dynamically generate narratives that evolve with user interactions, maintain character and plot continuity, and adjust story tone, complexity, and length to create a personalized reading experience.",
                    features: [
                        "User Profile Management allowing readers to create profiles with preferences such as age group, reading level, genre interests, and storytelling style.",
                        "Adaptive Story Generation Engine that dynamically creates stories based on user choices, preferences, and previous reading behavior.",
                        "Interactive Choice-Based Story Paths enabling readers to influence plot direction through branching decision points.",
                        "Narrative Memory System that stores story history, character traits, and plot developments to maintain continuity across sessions.",
                        "Dynamic Tone & Complexity Adjustment where the AI adapts vocabulary, pacing, and story depth based on the reader's age and comprehension level.",
                        "Character Consistency Framework ensuring that personalities, relationships, and story roles remain stable as the narrative evolves.",
                        "Story Progress Tracking Dashboard displaying reading history, chapter progression, and previously explored story branches.",
                        "Emotion-Aware Story Adaptation that adjusts story tone (adventure, suspense, humor, etc.) based on user interaction patterns.",
                        "Multi-Session Narrative Continuation allowing readers to resume stories seamlessly while preserving the entire plot context.",
                        "Visual Story Map showing branching paths and decisions made by the reader during the storytelling journey.",
                        "Admin Content Moderation Panel for managing story templates, genres, and AI safety filters.",
                        "Recommendation Engine suggesting new storylines or genres based on user reading patterns and engagement."
                    ],
                    set: "Set 1"
                },
                {
                    id: "14",
                    name: "TravelSense AI: Adaptive Smart Travel Companion & Real-Time Trip Optimizer",
                    slots: 3,
                    problemStatement: "Travelers frequently encounter unexpected issues such as traffic congestion, weather disruptions, transport delays, and unfamiliar routes during their trips. Most existing travel planning applications provide only static itineraries that do not adapt when circumstances change, leaving users without timely guidance or alternative options. An intelligent travel companion platform is required to dynamically monitor trip progress, analyze real-time travel conditions, and automatically adjust travel plans by suggesting alternative routes, activities, and alerts to ensure a smooth, personalized, and stress-free travel experience.",
                    features: [
                        "Personalized Trip Profile Management allowing users to define destinations, schedules, travel preferences, and activity interests.",
                        "AI-Based Adaptive Itinerary Engine that dynamically adjusts travel plans when delays, traffic issues, or weather disruptions occur.",
                        "Real-Time Travel Alerts notifying users about transport delays, road closures, weather warnings, or schedule changes.",
                        "Alternative Route & Activity Recommendation System suggesting faster routes or nearby attractions when travel plans change.",
                        "GPS-Based Trip Tracking that monitors travel progress and updates the itinerary based on the user's current location.",
                        "Interactive Map View displaying destinations, routes, nearby attractions, restaurants, and emergency services.",
                        "Travel Progress Dashboard showing trip milestones, completed destinations, and upcoming travel segments.",
                        "Context-Aware Recommendation Engine that suggests restaurants, events, or places to visit based on location and preferences.",
                        "Offline Travel Assistance enabling access to saved travel plans and maps even without internet connectivity.",
                        "Smart Notification System providing reminders for reservations, check-ins, transport schedules, and important travel updates.",
                        "Travel History & Insights Tracker that records past trips and provides personalized recommendations for future journeys.",
                        "AI Chat Travel Assistant that answers travel queries and helps users modify their plans instantly."
                    ],
                    set: "Set 2"
                },
                {
                    id: "15",
                    name: "SpeedPrep AI: Company-Specific Technical Quiz & Interview Practice Platform",
                    slots: 3,
                    problemStatement: "Students preparing for technical interviews often spend a significant amount of time searching for relevant practice questions that match the interview patterns of specific companies. Different companies emphasize different topics, difficulty levels, and problem-solving styles, making generic practice platforms less effective. A smart quiz platform is required that allows students to select a target company and role, then automatically generates timed quizzes and coding challenges aligned with that company's historical interview patterns, helping candidates prepare efficiently and track their progress.",
                    features: [
                        "Company-Based Quiz Generator allowing users to select companies such as Amazon, Google, or Microsoft and generate targeted technical quizzes.",
                        "Role-Specific Question Sets tailored for roles like Software Engineer, Data Analyst, or Backend Developer.",
                        "Timed MCQ Practice Rounds that simulate real technical screening tests with countdown timers.",
                        "Coding Challenge Module where users solve algorithmic problems similar to real interview questions.",
                        "Local JSON Question Database storing categorized questions by company, role, topic, and difficulty level.",
                        "Performance Analytics Dashboard showing accuracy, time spent, topic strengths, and weak areas.",
                        "Leaderboard System that ranks users based on quiz scores and completion time to encourage competitive learning.",
                        "Interview Pattern Simulation that structures quizzes based on common company interview formats.",
                        "Topic-Wise Practice Mode allowing students to focus on specific areas like DSA, DBMS, OS, or System Design.",
                        "Progress Tracking System recording past attempts and showing improvement trends over time.",
                        "Daily Challenge Mode offering new interview-style questions every day.",
                        "Admin Panel to add, edit, and categorize new questions in the JSON database."
                    ],
                    set: "Set 2"
                },
                {
                    id: "16",
                    name: "FoodBridge: Smart Food Waste Redistribution & Volunteer Coordination Platform",
                    slots: 3,
                    problemStatement: "Large amounts of edible food are wasted daily by restaurants, hotels, and event organizers, while many communities continue to face food insecurity. The lack of an efficient coordination system between food donors, NGOs, and volunteers leads to delays, logistics challenges, and missed opportunities to redistribute surplus food. A digital platform is required to connect food donors with nearby NGOs and volunteers, enabling quick listing of surplus food, efficient pickup coordination, and transparent tracking of food redistribution impact.",
                    features: [
                        "Food Donation Listing System allowing restaurants, event organizers, and individuals to quickly post available surplus food with quantity, type, and pickup time.",
                        "Smart Location Matching that connects donors with the nearest NGOs or volunteers using geolocation services.",
                        "Pickup Scheduling Module enabling NGOs or volunteers to accept donation requests and schedule food collection.",
                        "Real-Time Location Tracking to monitor the pickup and delivery process from donor to NGO or distribution center.",
                        "NGO Dashboard for managing incoming donation requests, tracking pickups, and coordinating volunteer activities.",
                        "Volunteer Registration System allowing individuals to sign up and assist in food collection and delivery.",
                        "Automated Notification System sending alerts to nearby NGOs or volunteers when a new donation becomes available.",
                        "Food Safety & Expiry Information to ensure donated food is safe and collected within a valid time window.",
                        "Impact Statistics Dashboard displaying total food rescued, meals served, and active donors or volunteers.",
                        "Donation History Tracker enabling donors to view past contributions and their community impact.",
                        "Admin Monitoring Panel for verifying NGOs, managing users, and tracking overall platform activity.",
                        "Community Awareness Section highlighting food waste reduction initiatives and encouraging responsible food donation."
                    ],
                    set: "Set 2"
                },
                {
                    id: "17",
                    name: "SmartFlow AI: Intelligent Traffic & Parking Management Platform",
                    slots: 3,
                    problemStatement: "Urban cities face increasing traffic congestion and inefficient parking utilization due to the lack of real-time monitoring and data-driven decision systems. Without intelligent analysis of traffic flow, city authorities struggle to identify congestion hotspots, predict peak traffic hours, and manage parking availability effectively. This leads to longer travel times, higher fuel consumption, and increased environmental pollution. A smart traffic and parking management platform is required to collect real-time traffic data, analyze congestion patterns using AI/ML models, monitor parking occupancy, and provide optimized signal timing and parking allocation recommendations for efficient urban mobility management.",
                    features: [
                        "Real-Time Traffic Data Monitoring using camera feeds, GPS data, or simulated datasets to track vehicle density across road networks.",
                        "AI-Based Congestion Detection Model that analyzes traffic flow patterns and identifies congestion-prone areas and peak hours.",
                        "Parking Occupancy Detection System that monitors parking space availability using sensors or computer vision techniques.",
                        "Smart Parking Availability Map showing real-time vacant parking slots across the city.",
                        "Dynamic Traffic Signal Optimization that recommends adaptive signal timings based on live traffic density.",
                        "Route Congestion Prediction Engine using machine learning models to forecast traffic conditions for the next time intervals.",
                        "Interactive City Dashboard displaying traffic heatmaps, congestion alerts, and parking availability status.",
                        "Vehicle Flow Analytics providing insights into traffic trends, peak hours, and frequently congested routes.",
                        "Parking Allocation Recommendation System guiding drivers to the nearest available parking spaces.",
                        "Real-Time Alert System notifying authorities about abnormal congestion or traffic incidents.",
                        "Environmental Impact Analytics showing estimated fuel savings and emission reduction through optimized traffic management.",
                        "Urban Planning Insights Dashboard helping city authorities analyze mobility patterns and plan infrastructure improvements."
                    ],
                    set: "Set 2"
                },

                {
                    id: "18",
                    name: "DataVault Secure: Privacy-First Personal Document Control Platform",
                    slots: 3,
                    problemStatement: "Individuals often store important personal documents such as identity proofs, certificates, and financial records across multiple platforms without clear control over how their data is accessed or shared. This fragmented storage increases the risk of data leaks, unauthorized access, and misuse of sensitive information. A privacy-first digital vault is required where users can securely store personal documents, control who can access them, share files temporarily when required, and maintain complete visibility over document access and usage.",
                    features: [
                        "Encrypted Document Storage that securely stores sensitive personal files using strong end-to-end encryption.",
                        "Secure Document Upload & Organization allowing users to categorize and manage documents such as IDs, certificates, and financial records.",
                        "Temporary Access Sharing Links enabling users to share documents with controlled expiry time and limited access permissions.",
                        "Role-Based Permission System allowing users to define who can view, download, or verify specific documents.",
                        "Identity Verification Layer requiring authentication or identity confirmation before granting document access.",
                        "Access Logs & Activity Tracking showing detailed records of who accessed a document, when, and from where.",
                        "Instant Access Revocation allowing users to immediately revoke shared document permissions.",
                        "Multi-Factor Authentication (MFA) providing an additional security layer for vault access.",
                        "Secure Verification Mode where organizations can verify documents without permanently storing them.",
                        "User Dashboard displaying document status, access history, and active sharing permissions.",
                        "Privacy Control Center enabling users to manage data visibility and document sharing preferences.",
                        "Admin Security Monitoring Panel for detecting suspicious access patterns and ensuring platform security."
                    ],
                    set: "Set 2"
                },
                {
                    id: "19",
                    name: "EcoCollect: Digital Waste Management Coordination & Recycling Platform",
                    slots: 3,
                    problemStatement: "Urban waste management systems often suffer from poor coordination between citizens, waste collectors, and recycling centers. Collection requests are not tracked efficiently, routes are poorly optimized, and recycling efforts are difficult to monitor. This leads to missed pickups, inefficient resource usage, and increased environmental impact. A digital coordination platform is required to streamline waste pickup requests, schedule collections efficiently, track recycling center activities, and provide real-time monitoring and analytics to improve the overall waste management process.",
                    features: [
                        "Citizen Waste Pickup Request System allowing users to report waste collection needs with location details and waste category.",
                        "Smart Collection Scheduling that assigns pickup tasks to waste collectors based on location and availability.",
                        "Recycling Center Tracking enabling monitoring of waste delivered to recycling facilities and processing status.",
                        "Route Optimization Dashboard for waste collection vehicles to minimize travel time and fuel consumption.",
                        "Collector Mobile Interface allowing waste collectors to view assigned pickups, update status, and navigate routes.",
                        "Waste Category Management supporting segregation of waste types such as organic, recyclable, and hazardous.",
                        "Real-Time Status Updates notifying citizens when their waste pickup is scheduled, in progress, or completed.",
                        "Environmental Impact Analytics displaying statistics such as total waste collected, recycled material, and carbon footprint reduction.",
                        "Admin Monitoring Panel for managing collectors, recycling centers, and pickup operations.",
                        "Community Awareness Module promoting waste segregation and responsible disposal practices.",
                        "Location-Based Notifications reminding citizens about scheduled waste collection days in their area.",
                        "Data Insights Dashboard helping municipalities analyze waste generation trends and improve collection planning."
                    ],
                    set: "Set 2"
                },
                {
                    id: "20",
                    name: "RescueLink: Real-Time Emergency Resource Locator Platform",
                    slots: 3,
                    problemStatement: "During emergencies such as road accidents, medical crises, or natural disasters, people often struggle to quickly locate nearby hospitals, blood donors, ambulances, and other critical services. The lack of a centralized platform for accessing verified emergency resources leads to delays in response and increases risk to lives. A real-time web application is required to help users instantly discover nearby emergency facilities, connect with volunteers, and access verified emergency contacts through an interactive map-based system.",
                    features: [
                        "Map-Based Emergency Search allowing users to locate nearby hospitals, blood banks, ambulances, and police stations using an interactive map interface.",
                        "Real-Time Resource Availability displaying updated information about hospital beds, emergency units, and available blood donors in the vicinity.",
                        "Emergency Contact Directory providing quick access to verified emergency numbers such as ambulance services, disaster response teams, and local authorities.",
                        "Volunteer Registration System enabling individuals to register as emergency responders, blood donors, or support volunteers.",
                        "Location-Based Alerts that notify nearby volunteers when an emergency request is raised in their area.",
                        "Quick SOS Request Feature allowing users to instantly send their location and emergency request to nearby responders.",
                        "Admin Monitoring Dashboard for managing emergency resources, verifying volunteers, and monitoring active emergency requests.",
                        "Mobile-Friendly Interface ensuring quick access to emergency services even during critical situations using smartphones."
                    ],
                    set: "Set 2"

                },
                {
                    id: "21",
                    name: "Unified Academic-Extracurricular Integration Ecosystem",
                    slots: 3,
                    problemStatement: "In many colleges, academic activities and extracurricular events are managed using separate systems. Event registrations, attendance, and club activities are often handled manually or through different platforms. This makes it difficult to track student participation and connect it with academic credits or recognition. Manual attendance also leads to issues like proxy attendance and data errors. A single digital platform is needed to manage campus events, track student participation in real time, and link extracurricular activities with academic records in a secure and efficient way.",
                    features: [
                        "Real-time event updates and notifications using Socket.IO so students can see event status and seat availability instantly.",
                        "QR Code-based attendance system to allow quick check-ins and reduce proxy attendance.",
                        "Academic credit integration where faculty can assign marks or credits for participating in approved events.",
                        "Role-Based Access Control (RBAC) with separate dashboards for Admins, Faculty, Students, and Event Volunteers.",
                        "Automatic certificate generation for students who complete events, with an online verification option.",
                        "Gamified participation system with leaderboards for students and clubs based on event activity.",
                        "Secure payment tracking for paid events with manual or automated verification.",
                        "Bulk upload feature to add students, faculty, or club details easily using CSV files."
                    ],
                    set: "Set 2"
                },
                {
                    id: "22",
                    name: "ReviewGuard AI: Fake Product Review Detection & Trust Analysis System",
                    slots: 3,
                    problemStatement: "Online product reviews significantly influence customer purchasing decisions. However, many businesses manipulate public perception by posting fabricated or misleading reviews to artificially boost product ratings. These deceptive reviews reduce consumer trust and make it difficult for users to identify genuine feedback. An AI-powered review analysis system is required to automatically detect fake or deceptive reviews by analyzing linguistic patterns, sentiment inconsistencies, and contextual features in review text. The platform should classify reviews as genuine or deceptive and provide transparency to help consumers make more informed purchasing decisions.",
                    features: [
                        "AI-Powered Fake Review Detection Model trained on labeled datasets such as the Deceptive Opinion Spam Corpus.",
                        "Natural Language Processing Pipeline including text preprocessing, tokenization, stop-word removal, and feature extraction.",
                        "Transformer-Based Review Classification using pre-trained language models such as BERT, RoBERTa, or XLNet for high-accuracy detection.",
                        "Sentiment Consistency Analysis to identify abnormal patterns between review sentiment and textual content.",
                        "Review Authenticity Scoring System that assigns a probability score indicating whether a review is genuine or fake.",
                        "Batch Review Analysis allowing businesses or platforms to scan multiple reviews simultaneously for suspicious content.",
                        "Explainable AI Insights highlighting keywords or phrases that influenced the fake review prediction.",
                        "Interactive Dashboard showing statistics on fake vs genuine reviews, sentiment distribution, and detection trends.",
                        "API Integration Support enabling e-commerce platforms to automatically verify reviews during submission.",
                        "Continuous Model Improvement using feedback data to enhance detection accuracy over time."
                    ],
                    set: "Set 2"

                },
                {
                    id: "23",
                    name: "MuseBot: AI Chatbot-Based Smart Ticketing & Visitor Management System",
                    slots: 3,
                    problemStatement: "Many museums still use manual ticket booking systems where visitors must stand in long queues to buy tickets. During weekends, holidays, or special exhibitions, this leads to delays, confusion, and poor visitor experience. Manual systems can also cause mistakes such as double bookings, wrong ticket details, or lost records. A chatbot-based online ticketing system can solve these problems by allowing visitors to book tickets easily through a chat interface, check availability, make payments online, and receive digital tickets instantly, improving both visitor convenience and museum management efficiency.",
                    features: [
                        "AI Conversational Chatbot allowing visitors to book tickets through a natural language chat interface on web or mobile platforms.",
                        "Automated Ticket Booking System supporting different ticket types such as general entry, exhibitions, and special shows.",
                        "Multilingual Chat Support enabling visitors from different regions to interact with the chatbot in multiple languages.",
                        "Integrated Payment Gateway allowing secure online payments for ticket purchases.",
                        "Real-Time Ticket Availability Monitoring to prevent overbooking and manage visitor capacity efficiently.",
                        "Visitor Information Assistant providing details about exhibitions, timings, events, and museum facilities.",
                        "High-Volume Request Handling enabling the chatbot to manage multiple booking requests simultaneously.",
                        "Digital Ticket Generation with QR codes for quick entry verification at the museum gate.",
                        "Visitor Analytics Dashboard providing insights on visitor trends, peak hours, ticket sales, and event popularity.",
                        "Automated Notifications sending booking confirmations, reminders, and event updates to visitors.",
                        "Admin Management Panel for managing ticket categories, pricing, events, and booking data.",
                        "Marketing & Promotion Module enabling the museum to recommend upcoming events or exhibitions to visitors during chatbot interaction."
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