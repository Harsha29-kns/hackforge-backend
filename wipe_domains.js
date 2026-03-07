require("dotenv").config();
const mongoose = require("mongoose");
const Domain = require("./module/Domain");

const wipeDomains = async () => {
    try {
        await mongoose.connect(process.env.URI);
        console.log("Connected to DB.");

        await Domain.deleteMany({});
        console.log("Successfully deleted all domains.");

        process.exit(0);
    } catch (err) {
        console.error("Error wiping domains:", err);
        process.exit(1);
    }
};

wipeDomains();
