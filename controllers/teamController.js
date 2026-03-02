const mongoose = require("mongoose");
const Domain = require("../module/Domain");
const hacksail = require("../module/hacksail"); // Adjust path if necessary
const qrcode = require('qrcode');
const { sendEmail } = require('../services/emailService');
const { paymentVerificationTemplate, qrCodeEmailTemplate, verificationSuccessTemplate } = require('../templates/emailTemplates');
const ServerSetting = require("../module/ServerSetting");
const { generateTeamPDF } = require('../services/pdfService');

exports.getTeamCount = async (req, res) => {
    try {
        const teamCount = await hacksail.countDocuments({});
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
        const team = await hacksail.findOne({ password: password, verified: true });
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

        // Simple count check (no transaction lock)
        const countTeam = await hacksail.countDocuments({});

        if (countTeam < registrationLimit) {
            const { name, email, teamname, teamMembers } = req.body;

            // --- VALIDATION ---
            if (!name || !email || !teamname || !Array.isArray(req.body.teamMembers) || req.body.teamMembers.length !== 4) {
                return res.status(400).json({ error: "Missing or invalid required fields. Team must have exactly 4 members." });
            }

            // Strict Email Validation for KLU
            if (!email.endsWith('@klu.ac.in')) {
                return res.status(400).json({ error: "Team Lead email must be a valid KLU ID (@klu.ac.in)" });
            }

            // Atomic create operation (no transaction)
            const data = await hacksail.create(req.body);

            // Send email asynchronously (don't block response)
            setImmediate(async () => {
                try {
                    const membersHtml = teamMembers.map((m, i) =>
                        `<li><strong>Member ${i + 1}:</strong> ${m.name} (${m.registrationNumber})</li>`
                    ).join('');

                    const emailHtml = `
                        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #ea580c;">Registration Received: ${teamname}</h2>
                            <p>Hello <strong>${name}</strong>,</p>
                            <p>You have successfully registered for the event. Here are your team details:</p>
                            
                            <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
                                <ul style="list-style-type: none; padding-left: 0;">
                                    <li><strong>Team Name:</strong> ${teamname}</li>
                                    <li><strong>Team Lead:</strong> ${name}</li>
                                    <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 10px 0;"/>
                                    ${membersHtml}
                                </ul>
                            </div>

                            <h3>Next Steps: Payment</h3>
                            <p>You need to pay the registration amount to confirm your slot for this event.</p>
                            <p><strong>You will receive another email shortly containing the payment link. Please be patient.</strong></p>

                            <div style="background-color: #fee2e2; border-left: 5px solid #ef4444; padding: 15px; margin-top: 25px; color: #b91c1c; border-radius: 4px;">
                                <strong>⚠️ IMPORTANT NOTE:</strong><br/>
                                Once we send the payment link, the Team Lead must complete the payment <strong>within 5 minutes</strong>. 
                                Otherwise, your team will lose the slot. Please be careful and keep an eye on your inbox!
                            </div>
                            
                            <br/>
                            <p>Best Regards,<br/>The HackSail Team</p>
                        </div>
                    `;

                    await sendEmail(email, `Registration Successful: ${teamname}`, emailHtml);
                } catch (emailError) {
                    console.error("Email sending failed:", emailError.message);
                }
            });

            // IMMEDIATE BROADCAST to all clients
            if (req.io) {
                const newCount = countTeam + 1;
                const isBeforeOpenTime = req.registrationOpenTime && new Date() < new Date(req.registrationOpenTime);
                const isFull = newCount >= registrationLimit;
                const isClosed = !!(isFull || req.isForcedClosed || isBeforeOpenTime);

                console.log(`[${new Date().toISOString()}] Registration completed. Broadcasting update:`, {
                    newCount,
                    limit: registrationLimit,
                    isClosed
                });

                req.io.emit("registrationStatus", {
                    isClosed: isClosed,
                    count: newCount,
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

// --- NEW PAYMENT FLOW CONTROLLERS ---

exports.sendPaymentLink = async (req, res) => {
    try {
        const { teamId } = req.body;
        const team = await hacksail.findById(teamId);

        if (!team) return res.status(404).json({ error: "Team not found" });

        // UPDATE THIS URL TO MATCH YOUR DEPLOYED FRONTEND URL
        const paymentLink = `https://hacksail-kare.vercel.app/payment-portal`;

        const emailHtml = `
            <div style="font-family: Arial, sans-serif;">
                <h2>Congratulations, ${team.teamname}!</h2>
                <p>Your team has been shortlisted for HackSail.</p>
                <p>To confirm your slot, please complete the payment process.</p>
                <p>
                    <a href="${paymentLink}" style="background-color: #ea580c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        Click Here to Pay
                    </a>
                </p>
                <p>Or visit: ${paymentLink}</p>
                <p>Use your registered email (<b>${team.email}</b>) to login.</p>
            </div>
        `;

        await sendEmail(team.email, "Action Required: HackSail Payment Link", emailHtml);

        res.status(200).json({ message: "Payment link sent successfully." });
    } catch (err) {
        console.error("Error sending payment link:", err);
        res.status(500).json({ error: "Failed to send email." });
    }
};

exports.validatePaymentEmail = async (req, res) => {
    try {
        const { email } = req.body;
        // Find team with this email
        const team = await hacksail.findOne({ email: email });

        if (!team) return res.status(404).json({ error: "No registration found for this email." });

        // Case 1: Already Verified
        if (team.verified) return res.status(400).json({ error: "This team is already verified." });

        // Case 2: Proof Already Uploaded (New Check)
        if (team.imgUrl) {
            return res.status(200).json({
                valid: true,
                alreadySubmitted: true, // Flag for frontend
                teamname: team.teamname
            });
        }

        // Case 3: Fresh Payment
        res.status(200).json({
            valid: true,
            teamname: team.teamname,
            teamId: team._id
        });
    } catch (err) {
        console.error("Error validating email:", err);
        res.status(500).json({ error: "Server error." });
    }
};

exports.submitPaymentProof = async (req, res) => {
    try {
        const { teamId, transtationId, upiId, imgUrl } = req.body;

        if (!teamId || !imgUrl) {
            return res.status(400).json({ error: "Missing required payment details." });
        }

        // Update team with payment details
        // The presence of 'imgUrl' moves them to "Under Verification" tab in Admin
        await hacksail.findByIdAndUpdate(teamId, {
            transtationId,
            upiId,
            imgUrl
        });

        res.status(200).json({ message: "Payment submitted. Waiting for verification." });
    } catch (err) {
        console.error("Error submitting payment proof:", err);
        res.status(500).json({ error: "Server error." });
    }
};

// ------------------------------------

exports.submitInternalGameScore = async (req, res) => {
    try {
        const { teamId } = req.params;
        const { score } = req.body;

        if (typeof score !== 'number') {
            return res.status(400).json({ error: 'Invalid score provided. Must be a number.' });
        }

        const team = await hacksail.findById(teamId);
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
        const team = await hacksail.findById(teamId);
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
        const allTeams = await hacksail.find({}, 'teamname').lean();

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
            const sasukeTeams = await hacksail.find({ Sector: "Sasuke" }, '_id').sort({ teamname: 1 }).limit(10);
            const sasukeIds = sasukeTeams.map(t => t._id);
            query = { $or: [{ Sector: "Naruto" }, { _id: { $in: sasukeIds } }] };
        } else { // judge2
            const sasukeTeams = await hacksail.find({ Sector: "Sasuke" }, '_id').sort({ teamname: 1 }).skip(10);
            const sasukeIds = sasukeTeams.map(t => t._id);
            query = { $or: [{ Sector: "Itachi" }, { _id: { $in: sasukeIds } }] };
        }

        // --- FIX IS ON THIS LINE ---
        // Fetch only the data needed, now including the Sector
        const teams = await hacksail.find(query,
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
        const team = await hacksail.findById(id);
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

        let teamsQuery = hacksail.find();

        if (limit > 0) {
            teamsQuery = teamsQuery.skip(skip).limit(limit);
        }

        const teams = await teamsQuery;
        const totalTeams = await hacksail.countDocuments();

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
        const teams = await hacksail.find({ Sector: sector });
        res.status(200).json({ teams });
    } catch (err) {
        console.error("Error in /students/:sector:", err);
        res.status(500).json({ error: "Internal server error" });
    }
};
exports.getGameLeaderboard = async (req, res) => {
    try {
        const teams = await hacksail.find(
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
        let Team = await hacksail.findById(id);
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
        let Team = await hacksail.findById(id);
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
        let Team = await hacksail.findById(id);
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
        const narutoTeams = await hacksail.find({ Sector: "Naruto" });
        const sasukeTeams = await hacksail.find({ Sector: "Sasuke" }).sort({ teamname: 1 }); // Sort to ensure consistent slicing
        const itachiTeams = await hacksail.find({ Sector: "Itachi" });

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
        const team = await hacksail.findById(id);
        if (!team) return res.status(404).json({ error: "Team not found." });

        // Only mark as verified — QR and password are generated separately
        team.verified = true;
        await team.save();

        if (req.io) {
            const verifiedTeamCount = await hacksail.countDocuments({ verified: true });
            req.io.emit("updateTeamCount", verifiedTeamCount);
        }

        // Send a simple approval confirmation email (no credentials yet)
        try {
            const approvalHtml = `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #16a34a;">Payment Approved – HackSail</h2>
                    <p>Hello <strong>${team.name}</strong>,</p>
                    <p>Great news! Your payment for team <strong>${team.teamname}</strong> has been verified and approved.</p>
                    <br/>
                    <p style="font-size: 16px;">
              <strong>Important:</strong> To receive your official Entry Pass, event schedule, and other critical updates, you MUST join our official WhatsApp group.
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://chat.whatsapp.com/C4HBKy7jMqm3VYSScw3AD5" style="text-decoration: none; background-color: #25D366; color: #ffffff; padding: 15px 35px; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 10px rgba(0,0,0,0.2); display: inline-flex; align-items: center; gap: 10px;">
                <span>Join Official WhatsApp Group</span>
              </a>
            </div>
                    <p>Best Regards,<br/>The Scorecraft Team</p>
                </div>
            `;
            await sendEmail(team.email, `Payment Approved – HackSail`, approvalHtml);
        } catch (emailErr) {
            console.error("Failed to send approval email:", emailErr);
        }

        res.status(200).json({ message: "Team verified successfully. Credentials not yet generated." });

    } catch (err) {
        console.error("--- VERIFICATION FAILED ---");
        console.error("Team ID:", req.params.id);
        console.error("Error Details:", err);
        res.status(500).json({ error: "Internal server error during verification.", details: err.message });
    }
};

exports.generateQRAndPass = async (req, res) => {
    try {
        const { id } = req.params;
        const team = await hacksail.findById(id);
        if (!team) return res.status(404).json({ error: "Team not found." });
        if (!team.verified) return res.status(400).json({ error: "Team must be verified before generating credentials." });

        const generatedPassword = Math.floor(100000 + Math.random() * 900000).toString();
        team.password = generatedPassword;

        const emailMemberList = [];

        const leadQrData = JSON.stringify({ teamId: team._id, registrationNumber: team.registrationNumber });
        if (!team.lead) team.lead = {};
        team.lead.qrCode = await qrcode.toDataURL(leadQrData);
        emailMemberList.push({ name: team.name, regNo: team.registrationNumber, isLead: true });

        for (let i = 0; i < team.teamMembers.length; i++) {
            const member = team.teamMembers[i];
            const memberQrData = JSON.stringify({ teamId: team._id, registrationNumber: member.registrationNumber });
            member.qrCode = await qrcode.toDataURL(memberQrData);
            emailMemberList.push({ name: member.name, regNo: member.registrationNumber, isLead: false });
        }

        await team.save();

        res.status(200).json({ message: "QR codes and password generated successfully.", password: generatedPassword });

    } catch (err) {
        console.error("--- QR/PASS GENERATION FAILED ---");
        console.error("Team ID:", req.params.id);
        console.error("Error Details:", err);
        res.status(500).json({ error: "Internal server error during QR/pass generation.", details: err.message });
    }
};

exports.getTeamByEmail = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email is required." });
        const team = await hacksail.findOne({ email: email.toLowerCase().trim() });
        if (!team) return res.status(404).json({ error: "No team found for this email. Please check and try again." });
        res.status(200).json({ team });
    } catch (err) {
        console.error("Error fetching team by email:", err);
        res.status(500).json({ error: "Internal server error." });
    }
};

exports.getEditDetailsStatus = async (req, res) => {
    try {
        const settings = await ServerSetting.findOne({ singleton: "main" });
        res.status(200).json({ isEditDetailsOpen: settings?.isEditDetailsOpen ?? false });
    } catch (err) {
        res.status(500).json({ error: "Could not fetch setting." });
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

        const team = await hacksail.findById(teamId);
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
        const team = await hacksail.findById(teamId);
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
        const team = await hacksail.findById(teamId);
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
        const team = await hacksail.findById(id);
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
        const team = await hacksail.findById(teamId);
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
        const updatedTeam = await hacksail.findByIdAndUpdate(
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

exports.updateTeam = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Remove immutable fields if any, or just trust admin
        delete updates._id;

        const updatedTeam = await hacksail.findByIdAndUpdate(id, updates, { new: true });

        if (!updatedTeam) {
            return res.status(404).json({ error: "Team not found" });
        }

        res.status(200).json({ message: "Team updated successfully", team: updatedTeam });
    } catch (error) {
        console.error("Error updating team:", error);
        res.status(500).json({ error: "Server error while updating team" });
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

        // Step 1: Delete all existing domains to ensure a clean slate
        await Domain.deleteMany({}, { session });
        console.log("Cleared all existing domains.");

        // Step 2: Insert the fresh list of default domains
        await Domain.insertMany(defaultDomains, { session });
        console.log("Inserted default domains with original slot counts.");

        // Step 3: Reset the Domain field for all teams
        await hacksail.updateMany({}, { $set: { Domain: null } }, { session });
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
        const teamsWithIssues = await hacksail.find({ 'issues.0': { $exists: true } });
        res.status(200).json(teamsWithIssues);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
};

exports.resolveIssue = async (req, res) => {
    try {
        const { teamId, issueId } = req.params;
        const team = await hacksail.findById(teamId);
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
exports.sendAllCredentials = async (req, res) => {
    try {
        const verifiedTeams = await hacksail.find({
            verified: true,
            password: { $exists: true, $ne: null }
        }).populate('lead');

        if (!verifiedTeams.length) {
            return res.status(404).json({ message: 'No verified teams found to send emails to.' });
        }

        let successCount = 0;
        let failureCount = 0;
        const failures = [];

        // Process emails sequentially to avoid overwhelming the mail server
        for (const team of verifiedTeams) {
            try {
                // Ensure team has a lead with an email address
                if (!team.email) {
                    console.warn(`Skipping team "${team.teamname}" - Missing lead email.`);
                    failureCount++;
                    failures.push({ team: team.teamname, reason: 'Missing lead email' });
                    continue; // Skip to the next team
                }

                const pdfBuffer = await generateTeamPDF(team);
                const emailHtml = `
                    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                        <h2>Hey, ${team.name}!</h2>
                        <p>Your team, <strong>${team.teamname}</strong>, get ready for HackSail 2026!</p>
                        <p>Attached to this email is your official <strong>Team Login Credentials PDF</strong>. It contains  information for the event, including:</p>
                        <ul>
                            <li>Your Team's unique <strong>Access Code</strong> for the dashboard.</li>
                            <li>Individual <strong>QR codes</strong> for each member for attendance tracking.</li>
                        </ul>
                        <p>Please <strong>download the attached PDF</strong> and distribute it to your team members immediately. Keep your Access Code safe and secure.</p>
                        <p>We're excited to see what you build!</p>
                        <br>
                        <p>Best Regards,</p>
                        <p><strong>The HackSail Team</strong></p>
                        <p><strong>Scorecraft Club</p>
                    </div>
                `;

                await sendEmail(
                    team.email,
                    `[IMPORTANT] Your HackSail Team Credentials for "${team.teamname}"`,
                    emailHtml,
                    [{
                        filename: `${team.teamname}_Credentials.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf',
                    }]
                );
                successCount++;
            } catch (emailError) {
                console.error(`Failed to send email to team "${team.teamname}":`, emailError);
                failureCount++;
                failures.push({ team: team.teamname, reason: emailError.message });
            }
        }

        res.status(200).json({
            message: `Email process completed.`,
            successCount,
            failureCount,
            failures
        });

    } catch (error) {
        console.error("Error in sendAllCredentials controller:", error);
        res.status(500).json({ message: 'A server error occurred while preparing to send emails.', error: error.message });
    }
};

/**
 * @description Sends credential PDF to a SINGLE specified team.
 * Triggered by an admin action.
 */
exports.sendSingleCredential = async (req, res) => {
    try {
        const { teamId } = req.params;
        const team = await hacksail.findById(teamId).populate('lead');

        if (!team) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        if (!team.verified) {
            return res.status(400).json({ message: 'Cannot send credentials to an unverified team.' });
        }
        if (!team.email) {
            return res.status(400).json({ message: 'This team does not have a lead email address on file.' });
        }

        const pdfBuffer = await generateTeamPDF(team);
        const emailHtml = `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>Hey, ${team.name}!</h2>
                <p>Your team, <strong>${team.teamname}</strong>, get ready for HackSail 2026!</p>
                <p>Attached to this email is your official <strong>Team Identity Card PDF</strong>. It contains vital information for the event, including:</p>
                <ul>
                    <li>Your Team's unique <strong>Access Code</strong> for the dashboard.</li>
                    <li>Individual <strong>QR codes</strong> for each member for attendance tracking.</li>
                </ul>
                <p>Please <strong>download the attached PDF</strong> and distribute it to your team members immediately. Keep your Access Code safe and secure.</p>
                <p>We're excited to see what you build!</p>
                <br>
                <p>Best Regards,</p>
                <p><strong>The HackSail Team</strong></p>
            </div>
        `;

        await sendEmail(
            team.email,
            `[IMPORTANT] Your HackSail Team Credentials for "${team.teamname}"`,
            emailHtml,
            [{
                filename: `${team.teamname}_Credentials.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
            }]
        );

        res.status(200).json({ message: `Credentials successfully sent to ${team.teamname}'s lead.` });
    } catch (error) {
        console.error(`Failed to send email to team ID "${req.params.teamId}":`, error);
        res.status(500).json({ message: 'Error sending email', error: error.message });
    }
};