// test.js
const { io } = require("socket.io-client");
const axios = require("axios");

// --- CONFIGURATION ---
// Make sure this points to your running server
const SERVER_URL = "http://localhost:3001";

async function runLoadTest() {
    console.log("🚀 Starting domain selection load test...");

    try {
        // --- STEP 1: Fetch all verified teams and available domains ---
        console.log("Fetching teams and domains...");
        const [teamsRes, domainsRes] = await Promise.all([
            axios.get(`${SERVER_URL}/Hack/students`), // Assuming this route returns all teams
            axios.get(`${SERVER_URL}/domains`)
        ]);

        const allTeams = teamsRes.data.teams.filter(t => t.verified); // We only care about verified teams
        const allDomains = domainsRes.data.filter(d => d.slots > 0); // We only care about domains with slots

        if (allTeams.length === 0 || allDomains.length === 0) {
            console.error("❌ Error: No verified teams or available domains found. Test cannot proceed.");
            return;
        }
        
        console.log(`Found ${allTeams.length} verified teams and ${allDomains.length} available domain slots.`);
        
        // --- STEP 2: Assign a unique domain slot to each team ---
        const assignments = [];
        let domainSlotIndex = 0;
        
        for (const team of allTeams) {
            if (domainSlotIndex < allDomains.length) {
                assignments.push({
                    teamId: team._id,
                    teamName: team.teamname,
                    domainId: allDomains[domainSlotIndex].id, // Using the domain's unique ID
                    domainName: allDomains[domainSlotIndex].name
                });
                domainSlotIndex++;
            }
        }
        
        const testSize = assignments.length;
        console.log(`Prepared ${testSize} teams for simultaneous domain selection.`);

        // --- STEP 3: Create a socket client for each team and connect ---
        const promises = assignments.map(assignment => {
            return new Promise((resolve, reject) => {
                const socket = io(SERVER_URL, {
                    transports: ["websocket"],
                    forceNew: true // Ensures a new connection for each "client"
                });

                let testFinished = false;

                // Set a timeout to prevent the test from hanging
                const timeout = setTimeout(() => {
                    if (!testFinished) {
                        socket.disconnect();
                        reject(`[${assignment.teamName}] Test timed out after 10 seconds.`);
                    }
                }, 10000);

                socket.on("connect", () => {
                    // console.log(`[${assignment.teamName}] Connected. Selecting domain: ${assignment.domainName}`);
                    // Once connected, emit the domain selection event
                    socket.emit("domainSelected", {
                        teamId: assignment.teamId,
                        domain: assignment.domainId
                    });
                });

                // --- STEP 4: Listen for the server's response ---
                socket.on("domainSelected", (response) => {
                    testFinished = true;
                    clearTimeout(timeout);
                    socket.disconnect();
                    if (response.error) {
                        reject(`[${assignment.teamName}] Failed: ${response.error}`);
                    } else {
                        resolve(`[${assignment.teamName}] Success: Selected ${response.domain.name}`);
                    }
                });

                socket.on("connect_error", (err) => {
                    if (!testFinished) {
                        clearTimeout(timeout);
                        reject(`[${assignment.teamName}] Connection Error: ${err.message}`);
                    }
                });
            });
        });
        
        // --- STEP 5: Execute all promises simultaneously and report results ---
        console.log("\n💥 Firing all requests now...\n");
        const results = await Promise.allSettled(promises);

        let successCount = 0;
        let failureCount = 0;

        console.log("--- TEST RESULTS ---");
        results.forEach(result => {
            if (result.status === 'fulfilled') {
                console.log(`✅ ${result.value}`);
                successCount++;
            } else {
                console.error(`❌ ${result.reason}`);
                failureCount++;
            }
        });
        
        console.log("\n--- SUMMARY ---");
        console.log(`Total Requests: ${testSize}`);
        console.log(`✅ Successes: ${successCount}`);
        console.log(`❌ Failures: ${failureCount}`);
        console.log("\nTest finished. Check your server logs and database to verify the final state.");

    } catch (error) {
        console.error("\n❌ An error occurred during the test setup:", error.message);
    }
}

runLoadTest();