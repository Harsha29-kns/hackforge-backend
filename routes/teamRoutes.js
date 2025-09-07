const express = require("express");
const router = express.Router();
const cors = require("cors");
const teamController = require("../controllers/teamController");

// Middleware specific to this router
router.use(express.json());
router.use(cors({ origin: "*" }));

// --- Team & Registration Routes ---
router.get("/teams/count", teamController.getTeamCount);
router.get("/test-email", teamController.testEmail);
router.post("/register", teamController.registerTeam);
router.get("/students", teamController.getAllStudents);

// --- Individual Team Routes ---
router.post("/team/:password", teamController.loginTeam);
router.get("/team/:id", teamController.getTeamById);
router.post("/team/score/:id", teamController.updateScore2);
router.post("/team/score1/:id", teamController.updateScore1);
router.post('/team/:teamId/number-puzzle-score', teamController.submitNumberPuzzleScore);
router.post('/team/:teamId/game-score', teamController.submitGameScore);

// --- Update Routes ---
router.post("/pro/:id", teamController.updateProblemId);
router.post("/sector/:id", teamController.updateSector);
router.post("/updateDomain", teamController.updateDomain);
router.post("/verify/:id", teamController.verifyTeam);
router.post("/admin/reset-domains", teamController.resetAllDomains);

// --- Attendance Routes ---
router.post("/attendance/submit", teamController.submitAttendance);

// --- Issue Tracking Routes ---
router.get("/issues", teamController.getIssues);
router.post("/issue/:teamId", teamController.addIssue);
router.post("/issue/resolve/:teamId/:issueId", teamController.resolveIssue);


module.exports = router;