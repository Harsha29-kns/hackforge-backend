const mongoose = require("mongoose");
const hackforge = require("../module/hackforge");
const Domain = require("../module/Domain");
const Reminder = require("../module/Reminder");
const PPT = require("../module/PPT");

const emitAllTeamStatuses = async (io, activeTeamSessions) => {
    try {
        const allTeams = await hackforge.find({}, 'teamname').lean();
        const teamsWithStatus = allTeams.map(team => ({
            ...team,
            isLoggedIn: activeTeamSessions.has(team._id.toString())
        }));
        io.emit('teamStatusUpdate', teamsWithStatus);
    } catch (error) {
        console.error("Error emitting team statuses:", error);
    }
};


// This function receives the 'io' instance, 'settings' object, and the check function
function initializeSockets(io, settings, checkRegistrationStatus, activeTeamSessions) {
    const broadcastActiveSessions = () => {
        io.emit('admin:activeSessionsUpdate', { count: activeTeamSessions.size });
    };

    io.on("connection", (socket) => {
        console.log(`A user connected: ${socket.id}`);

        
        socket.on('admin:getActiveSessions', () => {
            socket.emit('admin:activeSessionsUpdate', { count: activeTeamSessions.size });
        });

        // 1. When a client logs in successfully, it should emit this event
        socket.on('team:login', (teamId) => {
            // Check if this team already has an active session
            if (activeTeamSessions.has(teamId)) {
                // If yes, reject this new login attempt
                socket.emit('login:error', { message: 'This team is already logged in another device or contact sector incharge.' });
                return;
            }

            // If no, this is a valid login. Grant the session lock.
            activeTeamSessions.set(teamId, socket.id); // Lock the session with the current socket's ID
            broadcastActiveSessions(); // Notify all admins about the updated active sessions
            socket.teamId = teamId; // Store teamId on the socket object for easy access on disconnect

            console.log(`[Login Lock] Team ${teamId} has logged in with session ${socket.id}`);
            socket.emit('login:success');
        });

            socket.on('team:logout', () => {
            if (socket.teamId) {
                // Check if this socket is indeed the one holding the lock
                if (activeTeamSessions.get(socket.teamId) === socket.id) {
                    activeTeamSessions.delete(socket.teamId);
                    broadcastActiveSessions();
                    console.log(`[Logout Event] Team ${socket.teamId} has logged out. Session released.`);
                }
            }
        });
        socket.on('admin:forceLogout', async (teamId) => { 
            const socketId = activeTeamSessions.get(teamId);
            if (socketId && io.sockets.sockets.get(socketId)) {
                io.sockets.sockets.get(socketId).emit('forceLogout', { message: 'You are logged out due to admin action.' });
                activeTeamSessions.delete(teamId);
                io.emit('admin:activeSessionsUpdate', { count: activeTeamSessions.size });
                emitAllTeamStatuses(io, activeTeamSessions);
                
                try {
                    const team = await hackforge.findById(teamId);
                    if (team) {
                        console.log(`[Admin Action] Team "${team.teamname}" has been forcibly logged out.`);
                    } else {
                        console.log(`[Admin Action] Team with ID ${teamId} (not found) has been forcibly logged out.`);
                    }
                } catch (error) {
                    console.error("Error fetching team details for logging:", error);
                    console.log(`[Admin Action] Team with ID ${teamId} has been forcibly logged out.`);
                }
            }
        });

        // 2. When a user disconnects (e.g., closes browser), release the lock
        socket.on("disconnect", () => {
            if (socket.teamId && activeTeamSessions.has(socket.teamId)) {
                 // Check if the disconnected socket is the one holding the lock
                if (activeTeamSessions.get(socket.teamId) === socket.id) {
                    activeTeamSessions.delete(socket.teamId);
                    broadcastActiveSessions();
                    console.log(`[Socket Disconnect] Team ${socket.teamId} session released.`);
                    emitAllTeamStatuses(io, activeTeamSessions); // <<<--- Make sure this is here
                }
            }
             console.log(`User disconnected: ${socket.id}`);
        });

        socket.emit("gameStatusUpdate", settings.gameOpenTime);

        socket.on("check", checkRegistrationStatus);
        io.emit("domainStat", settings.domainStat);
        socket.on("admin:setGameOpenTime", async (isoTimestamp) => {
            settings.gameOpenTime = isoTimestamp;
            await settings.save();
            console.log(`Game opening time updated in DB: ${settings.gameOpenTime}`);
            io.emit("gameStatusUpdate", settings.gameOpenTime);
        });
        socket.on("admin:setPuzzleOpenTime", async (isoTimestamp) => {
        settings.puzzleOpenTime = isoTimestamp;
        await settings.save();
        console.log(`Puzzle opening time updated in DB: ${settings.puzzleOpenTime}`);
        io.emit("puzzleStatusUpdate", settings.puzzleOpenTime);
        });
        socket.on("admin:setStopTheBarTime", async (isoTimestamp) => {
            settings.stopTheBarOpenTime = isoTimestamp;
            await settings.save();
            console.log(`Stop the Bar opening time updated in DB: ${settings.stopTheBarOpenTime}`);
            io.emit("stopTheBarStatusUpdate", settings.stopTheBarOpenTime); // Broadcast the new time
        });
        socket.on("getGameStatus", () => {
            socket.emit("gameStatusUpdate", settings.gameOpenTime);
            socket.emit("puzzleStatusUpdate", settings.puzzleOpenTime);
            socket.emit("stopTheBarStatusUpdate", settings.stopTheBarOpenTime); // Send the current Stop the Bar time
        });



        socket.on("admin:setRegLimit", async (limit) => {
            const newLimit = parseInt(limit, 10);
            if (!isNaN(newLimit) && newLimit >= 0) {
                settings.registrationLimit = newLimit;
                await settings.save();
                console.log(`Registration limit updated in DB: ${settings.registrationLimit}`);
                checkRegistrationStatus();
            }
        });

        socket.on("admin:setRegOpenTime", async (isoTimestamp) => {
            settings.registrationOpenTime = isoTimestamp;
            settings.isForcedClosed = false;
            await settings.save();
            console.log(`Registration opening time updated in DB: ${settings.registrationOpenTime}`);
            checkRegistrationStatus();
        });

        socket.on("admin:forceCloseReg", async () => {
            settings.registrationOpenTime = null;
            settings.isForcedClosed = true;
            await settings.save();
            console.log("Registrations manually closed in DB.");
            checkRegistrationStatus();
        });

        socket.on("admin:forceOpenReg", async () => {
            settings.registrationOpenTime = null;
            settings.isForcedClosed = false;
            await settings.save();
            console.log("Registrations manually opened in DB.");
            checkRegistrationStatus();
        });

        socket.on("admin:setDomainTime", async (isoTimestamp) => { //new added...
        settings.domainStat = isoTimestamp;
        await settings.save();
        io.emit("domainStat", settings.domainStat);
        console.log(`Domain opening time set to: ${settings.domainStat}`);
    });

        socket.on("domainOpen", async () => {
            settings.domainStat = new Date(); // if seversetting is change to boolen  = true need to set
            await settings.save();
            io.emit("domainStat", settings.domainStat); //settings.domainStat -> true
            console.log("Domains opened in DB.");
        });

        socket.on("admin:closeDomains", async () => {
            settings.domainStat = null;// if seversetting is change to boolen  = false need to set
            await settings.save();
            io.emit("domainStat", null); // if seversetting is change to boolen  = false need to set
            console.log("Domains closed in DB.");
        });

        socket.on("client:getData", async () => {
            const reminders = await Reminder.find({}).sort({ time: -1 }).limit(10);
            const latestPPT = await PPT.findOne({}).sort({ uploadedAt: -1 });
            socket.emit("server:loadData", { reminders, ppt: latestPPT });
        });

        socket.on("join", (name) => {
            console.log(name);
            socket.join(name);
        });

        socket.on("domainStat", () => {
            io.emit("domainStat", settings.domainStat);
        });

        socket.on("domainSelected", async (team) => {
            try {
                const { teamId, domain: domainId } = team;
                if (!mongoose.Types.ObjectId.isValid(teamId) || !domainId) {
                    return io.to(socket.id).emit("domainSelected", { error: "Invalid team or domain ID." });
                }
                if (!settings.domainStat) {
                    return io.to(socket.id).emit("domainSelected", { error: "Domain selection is currently closed." });
                }
                const Team = await hackforge.findById(teamId);
                if (!Team) {
                    return io.to(socket.id).emit("domainSelected", { error: "Team not found." });
                }
                if (Team.Domain) {
                    return io.to(socket.id).emit("domainSelected", { error: `You already selected domain: ${Team.Domain}` });
                }
                const updatedDomain = await Domain.findOneAndUpdate(
                    { id: domainId, slots: { $gt: 0 } },
                    { $inc: { slots: -1 } },
                    { new: true }
                );
                if (!updatedDomain) {
                    return io.to(socket.id).emit("domainSelected", { error: "This domain is full. Please select another one." });
                }
                Team.Domain = updatedDomain.name;
                await Team.save();
                io.to(socket.id).emit("domainSelected", { success: true, domain: updatedDomain });
                const allDomains = await Domain.find({});
                const mapped = allDomains.map((d) => ({ ...d.toObject(), isFull: d.slots <= 0 }));
                io.emit("domaindata", mapped);
                io.emit('domains:updated');
            } catch (error) {
                console.error("Error processing domain selection:", error);
                io.to(socket.id).emit("domainSelected", { error: "An internal server error occurred. Please try again." });
            }
        });

        socket.on("client:getDomains", async () => {
            const domains = await Domain.find({});
            const mapped = domains.map((d) => ({ ...d.toObject(), isFull: d.slots <= 0 }));
            io.emit("domaindata", mapped);
        });

        socket.on("admin", async (team) => {
            const { name, lead, teamMembers } = team;
            socket.join(name);
            const Team = await hackforge.findOne({ teamname: name });
            if (Team) {
                Team.lead = lead;
                Team.teamMembers = teamMembers;
                io.to(name).emit("team", Team);
                await Team.save();
            }
        });
            socket.on("admin:setFirstReviewState", async (isOpen) => {
            settings.isFirstReviewOpen = isOpen;
            await settings.save();
            console.log(`First review state changed to: ${isOpen}`);
            io.emit("reviewStatusUpdate", { 
                isFirstReviewOpen: settings.isFirstReviewOpen,
                isSecondReviewOpen: settings.isSecondReviewOpen 
            });
        });

        socket.on("admin:setSecondReviewState", async (isOpen) => {
            settings.isSecondReviewOpen = isOpen;
            await settings.save();
            console.log(`Second review state changed to: ${isOpen}`);
            io.emit("reviewStatusUpdate", {
                isFirstReviewOpen: settings.isFirstReviewOpen,
                isSecondReviewOpen: settings.isSecondReviewOpen
                
            });
        });

        // For judges to get the current status on component mount
        socket.on("judge:getReviewStatus", () => {
            console.log("Judge requested review status");
            socket.emit("reviewStatusUpdate", {
                isFirstReviewOpen: settings.isFirstReviewOpen,
                isSecondReviewOpen: settings.isSecondReviewOpen
            });
        });

        socket.on("admin:sendReminder", async (data) => {
            const newReminder = new Reminder({ message: data.message });
            await newReminder.save();
            io.emit("admin:sendReminder", newReminder);
            console.log(`Broadcasted reminder: ${data.message}`);
        });

        socket.on("admin:sendPPT", async (data) => {
            const newPPT = new PPT({ fileName: data.fileName, fileUrl: data.fileUrl });
            await newPPT.save();
            io.emit("client:receivePPT", newPPT);
            console.log(`Broadcasted PPT template: ${data.fileName}`);
        });
    });
    
}

module.exports = initializeSockets;