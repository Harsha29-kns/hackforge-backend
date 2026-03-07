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
            // Judge 1: All Jack Sparrow (20) + first 10 Barbossa = 30 teams
            const barbossaTeams = await hacksail.find({ Sector: "Barbossa" }, '_id').sort({ teamname: 1 }).limit(10);
            const barbossaIds = barbossaTeams.map(t => t._id);
            query = { $or: [{ Sector: "Jack Sparrow" }, { _id: { $in: barbossaIds } }] };
        } else { // judge2
            // Judge 2: All jones (20) + remaining 10 Barbossa = 30 teams
            const barbossaTeams = await hacksail.find({ Sector: "Barbossa" }, '_id').sort({ teamname: 1 }).skip(10);
            const barbossaIds = barbossaTeams.map(t => t._id);
            query = { $or: [{ Sector: "jones" }, { _id: { $in: barbossaIds } }] };
        }

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
        const jackSparrowTeams = await hacksail.find({ Sector: "Jack Sparrow" });
        const barbossaTeams = await hacksail.find({ Sector: "Barbossa" }).sort({ teamname: 1 }); // Sort for consistent slicing
        const jonesTeams = await hacksail.find({ Sector: "jones" });

        if (judgeId === "judge1") {
            // All Jack Sparrow (20) + first 10 Barbossa = 30 teams
            teamsForJudge = [...jackSparrowTeams, ...barbossaTeams.slice(0, 10)];
        } else if (judgeId === "judge2") {
            // All jones (20) + remaining 10 Barbossa = 30 teams
            teamsForJudge = [...jonesTeams, ...barbossaTeams.slice(10)];
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

        // 1. Find team and check if already selected
        const team = await hacksail.findById(teamId);
        if (!team) return res.status(404).send("Team not found.");
        if (team.Domain) {
            return res.status(400).json({ error: "Your team has already selected a domain." });
        }

        // 2. Find and atomically decrement slots for the domain ONLY if slots > 0
        const updatedDomainDoc = await Domain.findOneAndUpdate(
            { id: domain, slots: { $gt: 0 } },
            { $inc: { slots: -1 } },
            { new: true }
        );

        if (!updatedDomainDoc) {
            return res.status(400).json({ error: "Sorry, this domain has no slots left or does not exist. Please select another." });
        }

        // 3. Save the domain NAME (or ID) to the team. 
        // Based on previous code, teams saved the domain name or ID. We will save the name for display purposes if that was the intent,
        // or just the id if they use the id. We'll save the name to match "✅ {team.Domain}" UI.
        const domainNameToSave = updatedDomainDoc.name;

        const updatedTeam = await hacksail.findByIdAndUpdate(
            teamId,
            { Domain: domainNameToSave },
            { new: true }
        );

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