const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        type: "OAuth2",
        user: process.env.MAIL,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    },
});

const sendEmail = async (to, subject, html, attachments = []) => {
    try {
        await transporter.sendMail({
            from: process.env.MAIL,
            to,
            subject,
            html,
            attachments,
        });
    } catch (err) {
        console.error("Error sending email:", err);
        throw new Error("Email delivery failed");
    }
};

module.exports = { sendEmail };