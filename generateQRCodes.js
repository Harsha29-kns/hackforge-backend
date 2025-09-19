const mongoose = require('mongoose');
const hackforge = require('./module/hackforge'); 
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');


const dbURI = 'mongodb://localhost:27017/scorecraft-kare'; 

mongoose.connect(dbURI)
    .then(() => console.log('MongoDB connected.'))
    .catch(err => console.error('MongoDB connection error:', err));

async function generateQrCodesForVerifiedTeams() {
    try {
        const verifiedTeams = await hackforge.find({ verified: true });

        if (verifiedTeams.length === 0) {
            console.log("No verified teams found.");
            return;
        }

        const qrCodeDirectory = path.join(__dirname, 'qrcodes');
        if (!fs.existsSync(qrCodeDirectory)) {
            fs.mkdirSync(qrCodeDirectory);
        }

        for (const team of verifiedTeams) {
            const qrData = JSON.stringify({
                teamname: team.teamname,
                password: team.password
            });

            const filePath = path.join(qrCodeDirectory, `${team.teamname}.png`);
            await qrcode.toFile(filePath, qrData);
            console.log(`QR code created for ${team.teamname}`);
        }

    } catch (error) {
        console.error("Error generating QR codes:", error);
    } finally {
        mongoose.disconnect();
    }
}

generateQrCodesForVerifiedTeams();