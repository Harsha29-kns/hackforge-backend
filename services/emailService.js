const { google } = require("googleapis");
const nodemailer = require("nodemailer");
require("dotenv").config();

const sendEmail = async (to, subject, html, attachments = []) => {
    try {
        // Initialize OAuth2 Client
        const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET,
            "https://developers.google.com/oauthplayground"
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.GMAIL_REFRESH_TOKEN
        });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Use Nodemailer to build the raw MIME email
        const transporter = nodemailer.createTransport({
            streamTransport: true,
            newline: 'windows'
        });

        const mailOptions = {
            from: `"Scorecraft" <${process.env.MAIL}>`,
            to,
            subject,
            html,
            attachments
        };

        const info = await transporter.sendMail(mailOptions);

        // Convert stream to Buffer
        const rawMessage = await new Promise((resolve, reject) => {
            const stream = info.message;
            let buffer = Buffer.from('');
            stream.on('data', (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
            });
            stream.on('end', () => {
                resolve(buffer);
            });
            stream.on('error', (err) => {
                reject(err);
            });
        });

        // Encode to Base64URL (required by Gmail API)
        const encodedMessage = rawMessage.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        // Send via Gmail API (HTTP)
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage
            }
        });

        console.log(`Email sent via Gmail API: ${res.data.id}`);
        return res.data;

    } catch (error) {
        console.error("Error sending email via Gmail API:", error);
        throw new Error("Email delivery failed: " + error.message);
    }
};

module.exports = { sendEmail };