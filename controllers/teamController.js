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