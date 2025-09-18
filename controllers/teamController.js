const mongoose = require("mongoose");
const Domain = require("../module/Domain");
const hackforge = require("../module/hackforge"); // Adjust path if necessary
const qrcode = require('qrcode');
const { sendEmail } = require('../services/emailService');
const { paymentVerificationTemplate, qrCodeEmailTemplate } = require('../templates/emailTemplates');
const ServerSetting = require("../module/ServerSetting");

exports.getTeamCount = async (req, res) => {
    try {
        const teamCount = await hackforge.countDocuments({});
        res.status(200).json({ count: teamCount });
    } catch (error) {
        console.error("Error fetching team count:", error);
        res.status(500).json({ message: "Error fetching team count" });
    }
};

exports.testEmail = async (req, res) => {
    try {
        console.log("Attempting to send a test email...");
        await sendEmail(
            process.env.MAIL,
            "Nodemailer OAuth 2.0 Test",
            "<h1>Success!</h1><p>If you received this, your OAuth 2.0 setup is working correctly.</p>"
        );
        console.log("Test email sent successfully.");
        res.status(200).json({ message: "Test email sent successfully! Check your inbox." });
    } catch (error) {
        console.error("Failed to send test email:", error);
        res.status(500).json({ message: "Failed to send test email.", error: error.message });
    }
};

exports.loginTeam = async (req, res) => {
    try {
        const { password } = req.params;
        const team = await hackforge.findOne({ password: password, verified: true });
        if (team) {
            return res.json(team);
        }
        res.status(401).json({ message: "Invalid credentials" });
    } catch (e) {
        res.status(500).json({ message: "Server error during login" });
    }
};

exports.registerTeam = async (req, res) => {
    try {
        if (req.isRegClosed) {
            return res.status(403).json({ message: "Registration is currently closed." });
        }

        const registrationLimit = req.registrationLimit;
        // 1. Check the number of teams first
        const countTeam = await hackforge.countDocuments({});

        if (countTeam < registrationLimit) {
            const { name, email, teamname } = req.body;
            if (!name || !email || !teamname || !Array.isArray(req.body.teamMembers) || req.body.teamMembers.length !== 4) {
                return res.status(400).json({ error: "Missing or invalid required fields." });
            }
            
            // 2. Create the new team
            const data = await hackforge.create(req.body);

            // Side-effects (emails, etc.) happen after creation
            try {
                const emailContent = paymentVerificationTemplate(name, teamname);
                await sendEmail(email, `Your team ${teamname} is under verification`, emailContent);
            } catch (postRegistrationError) {
                console.error("User registered, but post-registration tasks failed:", postRegistrationError.message);
            }

            if (req.io) {
                req.io.emit("registrationStatus", {
                    isClosed: req.isRegClosed,
                    count: countTeam + 1,
                    limit: registrationLimit
                });
            }
            return res.status(201).json({ message: "Team registered successfully", data });

        } else {
            return res.status(403).json({ message: "Registration is full. Cannot accept new teams." });
        }
    } catch (err) {
        if (err.code === 11000) { // Handle duplicate key error
            return res.status(409).json({ error: "This team name is already taken. Please choose another one." });
        }
        console.error("Error during registration:", err);
        return res.status(500).json({ error: "Internal server error during registration." });
    }
};

exports.submitInternalGameScore = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { score } = req.body;

        if (typeof score !== 'number') {
            return res.status(400).json({ error: 'Invalid score provided. Must be a number.' });
        }

        const team = await hackforge.findById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found.' });
        }

        team.internalGameScore = score;
        await team.save();

        // Notify clients that team data has been updated
        if (req.io) {
            req.io.emit("team", team);
        }
        if (req.io) {
            req.io.emit('scores:updated');
        }

        res.status(200).json({ success: true, message: 'Internal score updated successfully.', team });
    } catch (error) {
        console.error('Error saving internal game score:', error);
        res.status(500).json({ error: 'Server error while saving score.' });
    }
};


exports.submitGameScore = async (req, res) => {
    try {
        const settings = await ServerSetting.findOne({ singleton: "main" });
        if (!settings.gameOpenTime || new Date() < new Date(settings.gameOpenTime)) {
            return res.status(403).json({ error: 'The game is not open yet.' });
        }
        const { teamId } = req.params;
        const { score } = req.body;
        if (typeof score !== 'number') {
            return res.status(400).json({ error: 'Invalid score provided.' });
        }
        const team = await hackforge.findById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found.' });
        }
        if (team.memoryGamePlayed) {
            return res.status(403).json({ error: 'Game has already been played by this team.' });
        }
        team.memoryGameScore = score;
        team.memoryGamePlayed = true;
        await team.save();
        if (req.io) {
            req.io.emit('scores:updated'); // Notify all clients that scores have been updated
        }
        res.status(200).json({ success: true, message: 'Score saved successfully.', team });
    } catch (error) {
        console.error('Error saving game score:', error);
        res.status(500).json({ error: 'Server error while saving score.' });
    }
};
exports.getTeamLoginStatus = async (req, res, activeTeamSessions) => {
    try {
        // Fetch all teams from the database to get their names and IDs
        const allTeams = await hackforge.find({}, 'teamname').lean();

        // Map over the teams and check their login status from the in-memory map
        const teamsWithStatus = allTeams.map(team => ({
            ...team,
            isLoggedIn: activeTeamSessions.has(team._id.toString())
        }));

        res.status(200).json(teamsWithStatus);
    } catch (error) {
        console.error("Error fetching team login statuses:", error);
        res.status(500).json({ message: "Error fetching team login statuses" });
    }
};



exports.getReviewTeamsForJudge = async (req, res) => {
    const { judgeId } = req.params;
    if (!['judge1', 'judge2'].includes(judgeId)) {
        return res.status(400).json({ message: "Invalid judge ID." });
    }

    try {
        let query = {};
        if (judgeId === 'judge1') {
            const sasukeTeams = await hackforge.find({ Sector: "Sasuke" }, '_id').sort({ teamname: 1 }).limit(10);
            const sasukeIds = sasukeTeams.map(t => t._id);
            query = { $or: [{ Sector: "Naruto" }, { _id: { $in: sasukeIds } }] };
        } else { // judge2
            const sasukeTeams = await hackforge.find({ Sector: "Sasuke" }, '_id').sort({ teamname: 1 }).skip(10);
            const sasukeIds = sasukeTeams.map(t => t._id);
            query = { $or: [{ Sector: "Itachi" }, { _id: { $in: sasukeIds } }] };
        }

        // --- FIX IS ON THIS LINE ---
        // Fetch only the data needed, now including the Sector
        const teams = await hackforge.find(query, 
            'teamname Sector FirstReview FirstReviewScore SecoundReview SecoundReviewScore'
        );

        res.status(200).json(teams);

    } catch (error) {
        console.error("Error fetching review teams for judge:", error);
        res.status(500).json({ message: "Server error while fetching teams." });
    }
};


    

exports.getTeamById = async (req, res) => {
    try {
        const { id } = req.params;
        const team = await hackforge.findById(id);
        if (!team) {
            return res.status(404).json({ error: "Team not found." });
        }
        res.status(200).json(team);
    } catch (err) {
        console.error("Error fetching team by id:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

exports.getAllStudents = async (req, res) => {
    try {
        // --- Pagination Logic ---
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 0; // Default to 0 to return all if no limit is set
        const skip = (page - 1) * limit;

        let teamsQuery = hackforge.find();

        if (limit > 0) {
            teamsQuery = teamsQuery.skip(skip).limit(limit);
        }

        const teams = await teamsQuery;
        const totalTeams = await hackforge.countDocuments();

        res.status(200).json({
            teams,
            totalPages: limit > 0 ? Math.ceil(totalTeams / limit) : 1,
            currentPage: page,
        });
    } catch (err) {
        console.error("Error in /students:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.getStudentsBySector = async (req, res) => { // New function to get teams by sector
    try {
        const { sector } = req.params;
        const teams = await hackforge.find({ Sector: sector });
        res.status(200).json({ teams });
    } catch (err) {
        console.error("Error in /students/:sector:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.getGameLeaderboard = async (req, res) => {
    try {
        const teams = await hackforge.find(
            { verified: true }, // Only show verified teams
            'teamname memoryGameScore numberPuzzleScore stopTheBarScore internalGameScore' // Fetch all needed scores
        )
        .lean();

        
        const leaderboard = teams.map(team => ({
            _id: team._id,
            teamname: team.teamname,
            memoryGameScore: team.memoryGameScore || 0,
            numberPuzzleScore: team.numberPuzzleScore || 0,
            stopTheBarScore: team.stopTheBarScore || 0,
            internalGameScore: team.internalGameScore || 0,
            totalScore: (team.memoryGameScore || 0) + (team.numberPuzzleScore || 0) + (team.stopTheBarScore || 0) + (team.internalGameScore || 0)
        })).sort((a, b) => b.totalScore - a.totalScore); // Final sort after calculation

        res.status(200).json({ leaderboard });

    } catch (err) {
        console.error("Error fetching game leaderboard:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};



{/*
exports.updateScore3 = async (req, res) => {
    try {
        const { id } = req.params;
        const { ThirdReview, score } = req.body;
        let Team = await hackforge.findById(id);
        Team.ThirdReview = ThirdReview;
        Team.ThirdReviewScore = score;
        Team.FinalScore = Team.FirstReviewScore + Team.SecoundReviewScore + Team.ThirdReviewScore;
        await Team.save();
        res.json("done");
    } catch (e) {
        res.status(420).json("Server error");
    }
};
*/} //3 review removed
exports.updateScore2 = async (req, res) => {
    const settings = await ServerSetting.findOne({ singleton: "main" });
    if (!settings.isSecondReviewOpen) {
        return res.status(403).json({ message: "The second review round is currently closed." });
    }
    try {
        const { id } = req.params;
        const { SecoundReview, score } = req.body;
        let Team = await hackforge.findById(id);
        Team.SecoundReview = SecoundReview;
        Team.SecoundReviewScore = score;
        Team.FinalScore = Team.FirstReviewScore + Team.SecoundReviewScore; // + Team.ThirdReviewScore; //3 review removed
        await Team.save();
        res.json("done");
    } catch (e) {
        res.status(420).json("Server error");
    }
};

exports.updateScore1 = async (req, res) => {
    const settings = await ServerSetting.findOne({ singleton: "main" });
    if (!settings.isFirstReviewOpen) {
        return res.status(403).json({ message: "The first review round is currently closed." });
    }
    try {
        const { id } = req.params;
        const { FirstReview, score } = req.body;
        let Team = await hackforge.findById(id);
        Team.FirstReview = FirstReview;
        Team.FirstReviewScore = score;
        await Team.save();
        res.json("done");
    } catch (e) {
        console.log(e);
        res.status(500).json("Server error");
    }
};

exports.getTeamsForJudge = async (req, res) => {
    const { judgeId } = req.params;

    try {
        let teamsForJudge = [];
        const narutoTeams = await hackforge.find({ Sector: "Naruto" });
        const sasukeTeams = await hackforge.find({ Sector: "Sasuke" }).sort({ teamname: 1 }); // Sort to ensure consistent slicing
        const itachiTeams = await hackforge.find({ Sector: "Itachi" });

        if (judgeId === "judge1") {
            teamsForJudge = [...narutoTeams, ...sasukeTeams.slice(0, 10)];
        } else if (judgeId === "judge2") {
            teamsForJudge = [...itachiTeams, ...sasukeTeams.slice(10)];
        } else {
            return res.status(400).json({ message: "Invalid judge ID." });
        }

        res.status(200).json(teamsForJudge);
    } catch (error) {
        console.error("Error fetching teams for judge:", error);
        res.status(500).json({ message: "Server error while fetching teams for judge." });
    }
};

exports.verifyTeam = async (req, res) => {
    try {
        const { id } = req.params;
        const team = await hackforge.findById(id);
        if (!team) return res.status(404).json({ error: "Team not found." });

        const generatedPassword = Math.floor(100000 + Math.random() * 900000).toString();
        team.verified = true;
        team.password = generatedPassword;

        const emailAttachments = [];
        const emailMemberList = [];

        const leadQrData = JSON.stringify({ teamId: team._id, registrationNumber: team.registrationNumber });
        if (!team.lead) team.lead = {};
        team.lead.qrCode = await qrcode.toDataURL(leadQrData);
        emailAttachments.push({
            filename: `${team.name}_qrcode.png`,
            content: team.lead.qrCode.split("base64,")[1],
            encoding: 'base64',
            cid: 'qrcode0'
        });
        emailMemberList.push({ name: team.name, regNo: team.registrationNumber, isLead: true });

        for (let i = 0; i < team.teamMembers.length; i++) {
            const member = team.teamMembers[i];
            const memberQrData = JSON.stringify({ teamId: team._id, registrationNumber: member.registrationNumber });
            member.qrCode = await qrcode.toDataURL(memberQrData);
            
            emailAttachments.push({
                filename: `${member.name}_qrcode.png`,
                content: member.qrCode.split("base64,")[1],
                encoding: 'base64',
                cid: `qrcode${i + 1}`
            });
            emailMemberList.push({ name: member.name, regNo: member.registrationNumber, isLead: false });
        }
        
        await team.save();
        
        if (req.io) {
            const verifiedTeamCount = await hackforge.countDocuments({ verified: true });
            req.io.emit("updateTeamCount", verifiedTeamCount);
        }

        // const emailContent = qrCodeEmailTemplate(team.name, team.teamname, emailMemberList);
        // await sendEmail(team.email, `Your Team ${team.teamname} is Verified - QR Codes Attached`, emailContent, emailAttachments);

        res.status(200).json({
            message: "Team verified and QR codes sent successfully",
            password: generatedPassword
        });

    } catch (err) {
        // THIS IS THE CRITICAL CHANGE
        console.error("--- VERIFICATION FAILED ---");
        console.error("Team ID:", req.params.id);
        console.error("Error Details:", err); // This will print the full error object

        res.status(500).json({ 
            error: "Internal server error during verification.",
            details: err.message 
        });
    }
};

exports.submitStopTheBarScore = async (req, res) => {
    try {
        const settings = await ServerSetting.findOne({ singleton: "main" });
        if (!settings.stopTheBarOpenTime || new Date() < new Date(settings.stopTheBarOpenTime)) {
            return res.status(403).json({ error: 'The "Stop the Bar" game is not open yet.' });
        }

        const { teamId } = req.params;
        const { score } = req.body;

        if (typeof score !== 'number') {
            return res.status(400).json({ error: 'Invalid score provided.' });
        }

        const team = await hackforge.findById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found.' });
        }
        if (team.stopTheBarPlayed) {
            return res.status(403).json({ error: 'This game has already been played by your team.' });
        }

        team.stopTheBarScore = score;
        team.stopTheBarPlayed = true;
        await team.save();
        if (req.io) {
            req.io.emit('scores:updated');
        }

        res.status(200).json({ success: true, message: 'Score saved successfully.', team });
    } catch (error) {
        console.error('Error saving Stop the Bar score:', error);
        res.status(500).json({ error: 'Server error while saving score.' });
    }
};


exports.submitNumberPuzzleScore = async (req, res) => {
    try {
        const settings = await ServerSetting.findOne({ singleton: "main" }); 
        
        if (!settings.puzzleOpenTime || new Date() < new Date(settings.puzzleOpenTime)) {
            return res.status(403).json({ error: 'The Number Puzzle game is not open yet.' });
        }
        const { teamId } = req.params;
        const { score } = req.body;
        if (typeof score !== 'number') {
            return res.status(400).json({ error: 'Invalid score provided.' });
        }
        const team = await hackforge.findById(teamId);
        if (!team) {
            return res.status(404).json({ error: 'Team not found.' });
        }
        if (team.numberPuzzlePlayed) {
            return res.status(403).json({ error: 'Number Puzzle has already been played by this team.' });
        }
        team.numberPuzzleScore = score;
        team.numberPuzzlePlayed = true;
        await team.save();
        if (req.io) {
            req.io.emit('scores:updated');
        }
        res.status(200).json({ success: true, message: 'Score saved successfully.', team });
    } catch (error) {
        console.error('Error saving number puzzle score:', error);
        res.status(500).json({ error: 'Server error while saving score.' });
    }
};


exports.submitAttendance = async (req, res) => {
    try {
        const { teamId, roundNumber, attendanceData } = req.body;
        if (!teamId || !roundNumber || !attendanceData) {
            return res.status(400).json({ error: "Missing required fields." });
        }
        const team = await hackforge.findById(teamId);
        if (!team) {
            return res.status(404).json({ error: "Team not found." });
        }
        if (!team.lead) team.lead = {};
        if (!team.lead.attendance) team.lead.attendance = [];

        const leadStatus = attendanceData[team.registrationNumber];
        if (leadStatus) {
            const roundIndex = team.lead.attendance.findIndex(a => a.round == roundNumber);
            if (roundIndex > -1) {
                team.lead.attendance[roundIndex].status = leadStatus;
            } else {
                team.lead.attendance.push({ round: roundNumber, status: leadStatus });
            }
        }
        for (const member of team.teamMembers) {
            if (!member.attendance) member.attendance = [];
            const memberStatus = attendanceData[member.registrationNumber];
            if (memberStatus) {
                const roundIndex = member.attendance.findIndex(a => a.round == roundNumber);
                if (roundIndex > -1) {
                    member.attendance[roundIndex].status = memberStatus;
                } else {
                    member.attendance.push({ round: roundNumber, status: memberStatus });
                }
            }
        }
        await team.save();
        res.status(200).json({ message: `Attendance for Round ${roundNumber} for team ${team.teamname} submitted successfully.` });
    } catch (err) {
        console.error("Error submitting attendance:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};

exports.updateSector = async (req, res) => {
    try {
        const { id } = req.params;
        const { Sector } = req.body;
        const team = await hackforge.findById(id);
        if (!team) return res.status(404).json({ error: "Team not found." });
        team.Sector = Sector;
        await team.save();
        res.json({ message: "Sector updated", team });
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
};

exports.addIssue = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { issueText } = req.body;
        if (!issueText) return res.status(400).json({ error: "Issue text is required." });
        const team = await hackforge.findById(teamId);
        if (!team) return res.status(404).json({ error: "Team not found." });
        team.issues.push({ text: issueText, timestamp: new Date() });
        await team.save();
        res.status(200).json(team);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
};

exports.updateDomain = async (req, res) => {
    try {
        const { teamId, domain } = req.body;
        if (!teamId || !domain) {
            return res.status(400).send("Team ID and domain are required.");
        }
        const updatedTeam = await hackforge.findByIdAndUpdate(
            teamId,
            { Domain: domain },
            { new: true }
        );
        if (!updatedTeam) {
            return res.status(404).send("Team not found.");
        }
        res.status(200).json({ message: "Domain updated successfully", team: updatedTeam });
    } catch (error) {
        console.error("Error updating domain:", error);
        res.status(500).send("Server error while updating domain.");
    }
};



exports.resetAllDomains = async (req, res) => {
   
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        console.log("Starting hard reset of all domains and slots...");

        // --- Define the default domains and their original slot counts ---
        const defaultDomains = [
            {
                id: "1",
                name: "AI-Powered Code Review Assistant",
                slots: 5,
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
                slots: 5,
                description: `Collaboration is at the heart of modern software engineering, with teams often distributed across different cities and time zones. 
                While version control systems like Git allow asynchronous collaboration, there is a growing need for tools that enable developers to collaborate in real time. 
                The challenge here is to build a web-based collaborative code editor that allows multiple programmers to work on the same file simultaneously, similar to how Google Docs works for documents. 
                Such a system must ensure low-latency synchronization of edits, conflict resolution when two users modify the same section of code, and a smooth user experience across devices. 
                It should include features like syntax highlighting, auto-completion, and error detection, making it comparable in power to desktop IDEs. 
                Beyond simple editing, the platform could integrate built-in chat, audio/video conferencing, or in-line commenting features to support richer team communication.`,
                set: "Set 2"
            },
            {
                id: "3",
                name: "Gamified Learning Platform for Programmers",
                slots: 5,
                description: `Learning to program can be intimidating for beginners, often involving abstract concepts and steep learning curves. 
                A gamified learning platform aims to make programming more engaging by combining education with elements of competition, rewards, and interactivity. 
                The challenge is to design a system where learners can progress through coding challenges, solve puzzles, and earn points, badges, or achievements. 
                Instead of passively reading tutorials, users actively engage with real coding problems that grow in difficulty as they progress. 
                The platform could offer leaderboards to encourage healthy competition, while also allowing learners to form study groups or compete in coding duels.`,
                set: "Set 3"
            },
            {
                id: "4",
                name: "Decentralized Social Media Platform",
                slots: 5,
                description: `Current social media platforms are dominated by centralized corporations that control user data, algorithms, and monetization models. 
                This creates issues of censorship, data privacy violations, and lack of transparency. 
                The goal of this project is to design a decentralized social media platform built on blockchain or distributed ledger technologies. 
                Such a platform would give users greater control over their data and content, ensuring that no single authority can manipulate feeds or exploit personal information for profit.`,
                set: "Set 2"
            },
            {
                id: "5",
                name: "IoT-Based Smart Home Automation System",
                slots: 5,
                description: `The Internet of Things (IoT) is revolutionizing how humans interact with their environments, particularly within smart homes. 
                A smart home automation system enables users to remotely monitor and control appliances, lighting, security systems, and environmental conditions. 
                The challenge is to design a secure, efficient, and scalable IoT-based system that provides convenience, energy savings, and enhanced safety.`,
                set: "Set 3"
            },
            {
                id: "6",
                name: "Automated Bug Tracking and Reporting System",
                slots: 5,
                description: `Bug tracking is one of the most critical processes in software development, yet many existing systems rely heavily on manual reporting and prioritization. 
                This project aims to create an automated bug tracking and reporting system that can detect issues in real time, categorize them, and prioritize fixes based on severity. 
                Such a system would integrate directly with development pipelines, continuously analyzing logs, test results, and runtime errors to identify bugs without waiting for manual reports.`,
                set: "Set 1"
            },
            {
                id: "7",
                name: "Cloud-Based IDE for Remote Development",
                slots: 5,
                description: `Traditional Integrated Development Environments (IDEs) often require local installation, configuration, and maintenance, creating challenges for remote teams and distributed learning environments. 
                A cloud-based IDE solves this by allowing developers to code, build, and debug applications entirely through the web, accessible from any device. 
                The challenge is to design a robust platform that provides the same power and flexibility as local IDEs while ensuring seamless performance in a browser.`,
                set: "Set 1"
            },
            {
                id: "8",
                name: "Personalized E-commerce Recommendation Engine",
                slots: 5,
                description: `E-commerce has transformed the way people shop, but personalization remains a key driver of customer engagement and loyalty. 
                A personalized recommendation engine analyzes user behavior, purchase history, and browsing patterns to suggest products that are most relevant to each individual. 
                The challenge is to design a recommendation system that balances accuracy, scalability, and diversity, ensuring customers receive suggestions that are useful without being repetitive.`,
                set: "Set 3"
            },
            {
                id: "9",
                name: "Live Code-Sharing and Pair Programming Tool",
                slots: 5,
                description: `Pair programming and live collaboration are powerful practices for improving code quality and knowledge sharing, but existing tools are often fragmented. 
                The challenge is to build a real-time code-sharing and pair programming tool that allows developers to work together as if sitting side by side. 
                Such a system should enable instant sharing of code sessions with features like synchronized cursors, highlighting, and split-screen editing. 
                Built-in voice or video chat could allow developers to communicate seamlessly while coding.`,
                set: "Set 2"
            },
            {
                id: "10",
                name: "Blockchain-Based Voting System",
                slots: 5,
                description: `Voting systems play a vital role in democratic societies, but traditional approaches often face issues of transparency, security, and accessibility. 
                A blockchain-based voting system could address these challenges by providing immutable, tamper-proof records of votes, ensuring both security and verifiability. 
                The system must balance anonymity and transparency, allowing voters to confirm their votes were counted without revealing personal identities.`,
                set: "Set 1"
            },
            {
                id: "11",
                name: "AI-Powered Healthcare Diagnosis Assistant",
                slots: 5,
                description: `Healthcare systems worldwide are under increasing strain, and diagnostic errors remain a serious concern. 
                An AI-powered healthcare diagnosis assistant could analyze patient symptoms, medical history, and test results to provide preliminary diagnostic suggestions. 
                The challenge is ensuring accuracy, reliability, and compliance with medical standards, while also integrating with hospital record systems and protecting patient privacy.`,
                set: "Set 2"
            },
            {
                id: "12",
                name: "Smart Traffic Management System",
                slots: 5,
                description: `Urban areas worldwide face increasing traffic congestion, leading to wasted time, fuel consumption, and environmental pollution. 
                A smart traffic management system could leverage IoT sensors, real-time traffic data, and AI algorithms to optimize traffic light timings, reduce bottlenecks, and improve road safety. 
                The challenge includes scalability, integration with existing infrastructure, and ensuring real-time responsiveness.`,
                set: "Set 3"
            },
            {
                id: "13",
                name: "AI-Based Financial Fraud Detection System",
                slots: 5,
                description: `Financial institutions face constant threats from fraud, including identity theft, money laundering, and unauthorized transactions. 
                An AI-based fraud detection system could monitor transactions in real time, identify suspicious patterns, and prevent fraudulent activity. 
                The system must strike a balance between minimizing false positives and catching genuine threats, while also being adaptable to evolving fraud techniques.`,
                set: "Set 1"
            },
            {
                id: "14",
                name: "Virtual Reality for Remote Education",
                slots: 5,
                description: `The COVID-19 pandemic highlighted the limitations of traditional online education. 
                Virtual reality (VR) can revolutionize remote learning by creating immersive classrooms, interactive labs, and collaborative virtual spaces. 
                The challenge is to design affordable, accessible VR educational platforms that engage students and enhance learning outcomes while remaining scalable for widespread adoption.`,
                set: "Set 2"
            },
            {
                id: "15",
                name: "AI-Powered Mental Health Chatbot",
                slots: 5,
                description: `Mental health is a growing concern worldwide, but access to trained professionals is limited, particularly in underserved regions. 
                An AI-powered mental health chatbot could provide preliminary support, active listening, and coping strategies to individuals experiencing stress, anxiety, or depression. 
                The challenge is ensuring empathy, accuracy, and safety, while also guiding users toward professional help when necessary.`,
                set: "Set 3"
            }
        ];

        // Step 1: Delete all existing domains to ensure a clean slate
        await Domain.deleteMany({}, { session });
        console.log("Cleared all existing domains.");

        // Step 2: Insert the fresh list of default domains
        await Domain.insertMany(defaultDomains, { session });
        console.log("Inserted default domains with original slot counts.");

        // Step 3: Reset the Domain field for all teams
        await hackforge.updateMany({}, { $set: { Domain: null } }, { session });
        console.log("Cleared all team domain selections.");
        
        // If all operations succeed, commit the transaction
        await session.commitTransaction();
        
        // Notify clients in real-time if you have that feature enabled
        if (req.io) {
            req.io.emit('domains:updated');
        }

        res.status(200).json({ message: "All domains and teams have been successfully reset to default." });

    } catch (error) {
        // If any step fails, abort the entire transaction
        await session.abortTransaction();
        console.error("Error during hard domain reset:", error);
        res.status(500).json({ message: "Failed to reset domains due to a server error." });
    } finally {
        // Always end the session
        session.endSession();
    }
};

exports.getIssues = async (req, res) => {
    try {
        const teamsWithIssues = await hackforge.find({ 'issues.0': { $exists: true } });
        res.status(200).json(teamsWithIssues);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
};

exports.resolveIssue = async (req, res) => {
    try {
        const { teamId, issueId } = req.params;
        const team = await hackforge.findById(teamId);
        if (!team) return res.status(404).json({ error: "Team not found." });
        const issue = team.issues.id(issueId);
        if (issue) {
            issue.status = 'Resolved';
            await team.save();
        }
        res.status(200).json(team);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
};