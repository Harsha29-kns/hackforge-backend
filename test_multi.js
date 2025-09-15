const axios = require('axios');
const { io } = require('socket.io-client');

// --- CONFIGURATION ---
const BASE_URL = 'https://scorecraft-backend-73gb.onrender.com'; // Use your actual server URL
const REFRESH_DURATION_MS = 20000; // 10 seconds

/**
 * Simulates a single team logging in and repeatedly refreshing the dashboard data.
 * @param {object} team - The team object, must contain _id and password.
 */
function simulateTeam(team) {
    return new Promise((resolve, reject) => {
        let successfulRefreshes = 0;
        let failedRefreshes = 0;

        const socket = io(BASE_URL, {
            transports: ['websocket'],
            forceNew: true,
        });

        // Set a total timeout for the entire simulation for this user
        const totalTimeout = setTimeout(() => {
            socket.disconnect();
            reject({ teamName: team.teamname, reason: `Test timed out after ${REFRESH_DURATION_MS / 1000 + 5000}ms.` });
        }, REFRESH_DURATION_MS + 5000); // 10s for refresh + 5s buffer

        socket.on('connect', () => {
            // Step 1: Log in via HTTP to validate the password
            axios.post(`${BASE_URL}/Hack/team/${team.password}`)
                .then(res => {
                    // Step 2: Establish a WebSocket session to mimic a real user
                    socket.emit('team:login', res.data._id);
                })
                .catch(err => {
                    clearTimeout(totalTimeout);
                    socket.disconnect();
                    reject({ teamName: team.teamname, reason: `HTTP login failed: ${err.response?.data?.message || err.message}` });
                });
        });

        socket.on('login:success', async () => {
            console.log(`[${team.teamname}]: Login and session established. Starting refresh test...`);
            
            // Step 3: Continuously "refresh" the page data for the set duration
            const startTime = Date.now();
            while (Date.now() - startTime < REFRESH_DURATION_MS) {
                try {
                    await axios.post(`${BASE_URL}/Hack/team/${team.password}`);
                    successfulRefreshes++;
                } catch (error) {
                    failedRefreshes++;
                }
            }
            
            // Step 4: Clean up and resolve the promise
            clearTimeout(totalTimeout);
            socket.disconnect();
            resolve({
                teamName: team.teamname,
                successfulRefreshes,
                failedRefreshes,
            });
        });

        // --- Error Handling ---
        socket.on('login:error', (data) => {
            clearTimeout(totalTimeout);
            socket.disconnect();
            reject({ teamName: team.teamname, reason: `Session error: ${data.message}` });
        });

        socket.on('connect_error', (err) => {
            clearTimeout(totalTimeout);
            reject({ teamName: team.teamname, reason: `Connection error: ${err.message}` });
        });
    });
}


/**
 * Main function to run the load test.
 */
async function runLoadTest() {
    console.log('🚀 Starting team login and refresh load test...');
    let teamsToTest;

    try {
        console.log('Fetching all verified teams...');
        const teamsRes = await axios.get(`${BASE_URL}/Hack/students`);
        
        // Use only verified teams for the test
        teamsToTest = teamsRes.data.teams.filter(t => t.verified);

        if (teamsToTest.length === 0) {
            console.error('❌ No verified teams found. Test cannot proceed.');
            return;
        }
        console.log(`✅ Found ${teamsToTest.length} verified teams to simulate.`);
    } catch (error) {
        console.error(`\n❌ An unexpected error occurred during test setup: ${error.message}`);
        return;
    }

    const testPromises = teamsToTest.map(team => simulateTeam(team));

    console.log(`\n💥 Simulating ${testPromises.length} teams logging in and refreshing...\n`);
    const results = await Promise.allSettled(testPromises);

    let totalSuccesses = 0;
    let totalFailures = 0;
    let successfulTeams = 0;
    let failedTeams = 0;

    console.log('--- Test Results ---');
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            const { teamName, successfulRefreshes, failedRefreshes } = result.value;
            console.log(`✅ SUCCESS: [${teamName}] - Completed with ${successfulRefreshes} successful refreshes and ${failedRefreshes} failures.`);
            totalSuccesses += successfulRefreshes;
            totalFailures += failedRefreshes;
            successfulTeams++;
        } else {
            const { teamName, reason } = result.reason;
            console.error(`❌ FAILED: [${teamName}] - ${reason}`);
            failedTeams++;
        }
    });

    console.log('\n--- Summary ---');
    console.log(`- Teams Simulated: ${testPromises.length}`);
    console.log(`- Teams Completed Successfully: ${successfulTeams}`);
    console.log(`- Teams Failed: ${failedTeams}`);
    console.log('---');
    console.log(`- Total Successful API Requests: ${totalSuccesses}`);
    console.log(`- Total Failed API Requests: ${totalFailures}`);
    console.log('\nTest finished.');
}

runLoadTest();