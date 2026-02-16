const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        type: "OAuth2",
        user: process.env.MAIL,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    },
    // Adding timeouts to prevent the process from hanging too long
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    tls: {
        rejectUnauthorized: false
    },
    family: 4, // Force IPv4 to avoid IPv6 timeouts on Render
    debug: true, // Show verbose logs
    logger: true, // Log to console
});

// ADD THIS: Verify connection on startup
transporter.verify((error, success) => {
    if (error) {
        console.error("Transporter connection error (v4):", error);
    } else {
        console.log("Server is ready to take our messages (v4)");
    }
});

const sendEmail = async (to, subject, html, attachments = []) => {
    try {
        await transporter.sendMail({
            from: `"Scorecraft" <${process.env.MAIL}>`, // Adding a "Friendly Name"
            to,
            subject,
            html,
            attachments,
        });
    } catch (err) {
        // Detailed logging helps catch if the Refresh Token has expired
        console.error("Error sending email details (v4 - IPv4):", err.message);
        throw new Error("Email delivery failed");
    }
};

module.exports = { sendEmail };