const express = require("express");
const router = express.Router();
const cors = require("cors");
const teamController = require("../controllers/teamController");

module.exports = function(activeTeamSessions) {
    // Middleware specific to this router
    router.use(express.json());
    router.use(cors({ origin: "*" }));

    // --- Team & Registration Routes ---
    router.get("/teams/count", teamController.getTeamCount);
    router.get("/test-email", teamController.testEmail);
    router.post("/register", teamController.registerTeam);
    router.get("/students", teamController.getAllStudents);
    router.get("/judge/:judgeId/teams", teamController.getTeamsForJudge); // Teams assigned to a judge
    router.get("/students/:sector", teamController.getStudentsBySector); // Filtered by sector
    router.get("/leaderboard/game", teamController.getGameLeaderboard); // Game leaderboard

    // --- Individual Team Routes ---
    router.post("/team/:password", teamController.loginTeam);
    router.get("/team/:id", teamController.getTeamById);
    router.post("/team/score/:id", teamController.updateScore2); //review2
    router.post("/team/score1/:id", teamController.updateScore1); //review1
    //router.post("/team/score3/:id", teamController.updateScore3);
    router.post('/team/:teamId/number-puzzle-score', teamController.submitNumberPuzzleScore);
    router.post('/team/:teamId/game-score', teamController.submitGameScore);
    router.post('/team/:teamId/internal-score', teamController.submitInternalGameScore);
    router.post('/team/:teamId/stop-the-bar-score', teamController.submitStopTheBarScore);
    router.get("/review/teams/:judgeId", teamController.getReviewTeamsForJudge); // Teams for review by judge

    // --- Update Routes ---

    router.post("/sector/:id", teamController.updateSector);
    router.post("/updateDomain", teamController.updateDomain);
    router.post("/verify/:id", teamController.verifyTeam);
    router.post("/admin/reset-domains", teamController.resetAllDomains);
    
    // Pass activeTeamSessions to the controller for this specific route
    router.get("/teams/status", (req, res) => teamController.getTeamLoginStatus(req, res, activeTeamSessions));

    // --- Attendance Routes ---
    router.post("/attendance/submit", teamController.submitAttendance);

    // --- Issue Tracking Routes ---
    router.get("/issues", teamController.getIssues);
    router.post("/issue/:teamId", teamController.addIssue);
    router.post("/issue/resolve/:teamId/:issueId", teamController.resolveIssue);
    router.post("/admin/send-all-credentials", teamController.sendAllCredentials);
    router.post("/admin/send-credential/:teamId", teamController.sendSingleCredential);

    return router;
};