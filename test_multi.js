// A conceptual script for race condition testing
const { io } = require("socket.io-client");

const API_URL = "http://localhost:3001";
const TEAM_A_ID = "68b5d8000e3835e65c6c2f44";
const TEAM_B_ID = "68b95d6114d893248f390c5e";
const DOMAIN_ID_TO_TEST = "1"; // The domain with 1 slot left

function runDomainSelection(teamId) {
    return new Promise((resolve, reject) => {
        const client = io(API_URL);
        client.on("connect", () => client.emit("team:login", teamId));

        client.on("login:success", () => {
            console.log(`Team ${teamId} logged in, attempting to select domain...`);
            client.emit("domainSelected", { teamId: teamId, domain: DOMAIN_ID_TO_TEST });
        });

        // Listen for the result of the domain selection
        client.on("domainSelected", (response) => {
            if (response.success) {
                resolve({ teamId, status: "SUCCESS" });
            } else {
                resolve({ teamId, status: "FAILURE", error: response.error });
            }
            client.disconnect();
        });
    });
}

// Run both attempts at the same time
Promise.all([
    runDomainSelection(TEAM_A_ID),
    runDomainSelection(TEAM_B_ID)
]).then(results => {
    console.log("\n--- Race Condition Test Results ---");
    console.log(results);

    const successes = results.filter(r => r.status === "SUCCESS").length;
    if (successes === 1) {
        console.log("✅ SUCCESS: Exactly one team got the domain slot. The logic is working.");
    } else {
        console.error(`❌ FAILED: ${successes} teams got the slot. The logic is NOT atomic.`);
    }
});