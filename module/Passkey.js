const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const passkeySchema = new mongoose.Schema({
    identifier: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        required: true,
        enum: ['admin', 'judge', 'sector', 'test'] // Defining the allowed roles
    }
}, { timestamps: true });

// Pre-save hook to hash the password before saving to database
passkeySchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// Helper method to compare passwords
passkeySchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Passkey', passkeySchema);
