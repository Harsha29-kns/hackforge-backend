require('dotenv').config();
const mongoose = require('mongoose');
const Domain = require('./module/Domain');
const hacksail = require('./module/hacksail');

// MongoDB on local standalone instances doesn't support transactions.
// This script bypasses transactions to manually wipe the selections.
async function wipeDomainsWithoutTransactions() {
    console.log('🚀 Initiating Local Domain & Team Reset...');
    try {
        console.log(`Connecting to MongoDB at ${process.env.URI} ...`);
        await mongoose.connect(process.env.URI);
        console.log('✅ Connected to MongoDB.');

        // 1. Delete all existing domains (you can re-upload them via seed scripts or endpoints)
        console.log("🗑️  Deleting all existing domains from the database...");
        const domainDeleteResult = await Domain.deleteMany({});
        console.log(`✅ Deleted ${domainDeleteResult.deletedCount} domains.`);

        // 2. Clear the 'Domain' field from all teams
        console.log("🧹 Resetting the Domain selection for all teams...");
        const teamUpdateResult = await hacksail.updateMany({}, { $set: { Domain: null } });
        console.log(`✅ Reset Domain field for ${teamUpdateResult.modifiedCount} teams.`);

        console.log('\n🎉 All domains and team selections have been successfully reset!');
        process.exit(0);
    } catch (error) {
        console.error(`\n❌ Failed to reset domains: ${error.message}`);
        process.exit(1);
    }
}

wipeDomainsWithoutTransactions();
