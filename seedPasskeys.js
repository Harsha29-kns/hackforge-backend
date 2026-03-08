const mongoose = require('mongoose');
require('dotenv').config();
const Passkey = require('./module/Passkey'); // Adjust path if needed

const seedDatabase = async () => {
    try {
        await mongoose.connect(process.env.URI);
        console.log("Connected to MongoDB...");

        const count = await Passkey.countDocuments();
        if (count > 0) {
            console.log("Passkeys are already initialized. No action taken.");
            process.exit(0);
        }

        const initialKeys = [
            { identifier: 'admin', password: 'harsha', role: 'admin' },
            { identifier: 'judge1', password: 'Harsha@35', role: 'judge' },
            { identifier: 'judge2', password: 'Bhuvan@43', role: 'judge' },
            { identifier: 'Jack Sparrow', password: 'score2025', role: 'sector' },
            { identifier: 'Barbossa', password: 'hackforge', role: 'sector' },
            { identifier: 'jones', password: 'clubscore', role: 'sector' }
        ];

        await Passkey.create(initialKeys);
        console.log("Successfully seeded initial passkeys!");
        process.exit(0);
    } catch (err) {
        console.error("Error seeding database:", err);
        process.exit(1);
    }
};

seedDatabase();
