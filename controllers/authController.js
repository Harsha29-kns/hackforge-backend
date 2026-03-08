const Passkey = require('../module/Passkey');
const jwt = require('jsonwebtoken');

// Ensure you set this in your .env file
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development_only';

exports.login = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Identifier and password are required' });
        }

        const passkey = await Passkey.findOne({ identifier });

        if (!passkey) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await passkey.comparePassword(password);

        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            { id: passkey._id, identifier: passkey.identifier, role: passkey.role },
            JWT_SECRET,
            { expiresIn: '24h' } // Token expires in 24 hours
        );

        res.status(200).json({
            message: 'Login successful',
            token,
            role: passkey.role,
            identifier: passkey.identifier
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error during login' });
    }
};

// --- ONE-TIME SETUP ENDPOINT (Can be removed or secured later) ---
exports.initPasskeys = async (req, res) => {
    try {
        // Prevent accidental overwrites if keys already exist
        const count = await Passkey.countDocuments();
        if (count > 0) {
            return res.status(400).json({ message: 'Passkeys already initialized' });
        }

        const initialKeys = [
            // Admin
            { identifier: 'admin', password: 'harsha', role: 'admin' },
            // Judges
            { identifier: 'judge1', password: 'Harsha@35', role: 'judge' },
            { identifier: 'judge2', password: 'Bhuvan@43', role: 'judge' },
            // Sectors for Attendance
            { identifier: 'Jack Sparrow', password: 'score2025', role: 'sector' },
            { identifier: 'Barbossa', password: 'hackforge', role: 'sector' },
            { identifier: 'jones', password: 'clubscore', role: 'sector' }
        ];

        // Insert using .create() to ensure the pre-save hook runs and hashes the passwords
        await Passkey.create(initialKeys);

        res.status(201).json({ message: 'Initial passkeys successfully generated' });
    } catch (error) {
        console.error('Initialization error:', error);
        res.status(500).json({ error: 'Failed to initialize passkeys' });
    }
};
