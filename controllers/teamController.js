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
        res.status(200).json({ success: true, message: 'Score saved successfully.', team });
    } catch (error) {
        console.error('Error saving game score:', error);
        res.status(500).json({ error: 'Server error while saving score.' });
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

        res.status(200).json({ success: true, message: 'Score saved successfully.', team });
    } catch (error) {
        console.error('Error saving Stop the Bar score:', error);
        res.status(500).json({ error: 'Server error while saving score.' });
    }
};


exports.submitNumberPuzzleScore = async (req, res) => {
    try {
        const settings = await ServerSetting.findOne({ singleton: "main" }); // <-- Add this line
        // This assumes you'll add a 'numberPuzzleOpenTime' to your settings
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


// Replace your old resetAllDomains function with this one
exports.resetAllDomains = async (req, res) => {
    // ⚠️ Security: Add proper admin authentication middleware in a real application.
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        console.log("Starting hard reset of all domains and slots...");

        // --- Define the default domains and their original slot counts ---
        const defaultDomains = [
            { id: "1", name: "Cybersecurity", slots: 10, description: "Focus on digital security and defense.", set: "Set 1" },
            { id: "2", name: "AI/ML", slots: 10, description: "Develop intelligent systems and models.", set: "Set 1" },
            { id: "3", name: "Web Development", slots: 10, description: "Build modern web applications.", set: "Set 2" },
            { id: "4", name: "Mobile App Dev", slots: 10, description: "Create applications for mobile devices.", set: "Set 2" },
            { id: "5", name: "IoT", slots: 10, description: "Connect physical devices to the internet.", set: "Set 3" },
            { id: "6", name: "Blockchain", slots: 10, description: "Work with decentralized technologies.", set: "Set 3" },
            { id: "7", name: "Cloud Computing", slots: 10, description: "Leverage cloud platforms and services.", set: "Set 1" },
            // Add any other default domains you have here
            { id: "8", name: "Digital Learning Platforms", slots: 10, description: "Innovate in education technology.", set: "Set 3" },
            { id: "9", name: "Student Engagement", slots: 10, description: "Enhance student interaction and experience.", set: "Set 2" },
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