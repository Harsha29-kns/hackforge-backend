const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Route for logging in
router.post('/login', authController.login);

// Temporary initialization route for seeding DB
router.post('/init', authController.initPasskeys);

module.exports = router;
