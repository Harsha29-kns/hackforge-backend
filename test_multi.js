const axios = require('axios');
const { io } = require('socket.io-client');

// --- CONFIGURATION ---
// IMPORTANT: Change this to your live server URL when testing in production
//const BASE_URL = 'https://scorecraft-backend-73gb.onrender.com';
const BASE_URL = 'http://localhost:3001';

// Set the duration for how long the teams should remain logged in
const TEST_DURATION_MS = 4 * 60 * 1000; // 2 minutes

// This array will store the active sessions (socket and team data) for logout
let activeSessions = [];

async function runLoginLogoutTest() {
  console.log(`🚀 Starting concurrent login test. Duration: ${TEST_DURATION_MS / 60000} minutes.`);

  try {
    // Step 1: Fetch all teams to be used in the test
    console.log('Fetching all teams from the server...');
    const teamsRes = await axios.get(`${BASE_URL}/Hack/students`);

    // You can adjust the filter as needed. Here we take all verified teams.
    const teamsToTest = teamsRes.data.teams.filter(t => t.verified);

    if (teamsToTest.length === 0) {
      console.error('❌ No verified teams found. Test cannot proceed.');
      return;
    }
    console.log(`✅ Found ${teamsToTest.length} teams for the test.`);

    // Step 2: Create a login promise for each team
    const loginPromises = teamsToTest.map(team => {
      return new Promise((resolve, reject) => {
        const socket = io(BASE_URL, {
          transports: ['websocket'],
          forceNew: true, // Ensures a new connection for each team
        });

        const loginPayload = {
          teamId: team._id,
          teamName: team.teamname,
          password: team.password,
        };

        // Set a timeout for the login process itself
        const timeout = setTimeout(() => {
          socket.disconnect();
          reject({ ...loginPayload, reason: 'Login timed out after 20 seconds.' });
        }, 20000);

        socket.on('connect', () => {
          // First, perform the HTTP login to get a session/token
          axios.post(`${BASE_URL}/Hack/team/${loginPayload.password}`)
            .then(res => {
              // On success, establish the authenticated socket session
              socket.emit('team:login', res.data._id);
            })
            .catch(err => {
              clearTimeout(timeout);
              socket.disconnect();
              reject({ ...loginPayload, reason: `HTTP login failed: ${err.response?.data?.message || err.message}` });
            });
        });

        // Listen for successful login confirmation from the server
        socket.on('login:success', () => {
          clearTimeout(timeout);
          // Resolve with the necessary session info for the logout step
          resolve({
            socket, // The active socket connection
            teamId: loginPayload.teamId,
            teamName: loginPayload.teamName,
          });
        });

        // Handle connection and login errors
        socket.on('login:error', (data) => {
          clearTimeout(timeout);
          socket.disconnect();
          reject({ ...loginPayload, reason: `Socket login error: ${data.message}` });
        });

        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          reject({ ...loginPayload, reason: `Connection error: ${err.message}` });
        });
      });
    });

    // Step 3: Execute all login attempts simultaneously and wait for results
    console.log(`\n💥 Simulating ${loginPromises.length} teams logging in now...\n`);
    const results = await Promise.allSettled(loginPromises);

    results.forEach(result => {
      if (result.status === 'fulfilled') {
        console.log(`✅ LOGIN SUCCESS: [${result.value.teamName}]`);
        activeSessions.push(result.value); // Store successful session for later
      } else {
        console.error(`❌ LOGIN FAILED: [${result.reason.teamName}] - ${result.reason.reason}`);
      }
    });

    console.log('\n--- Login Summary ---');
    console.log(`Total Login Attempts: ${loginPromises.length}`);
    console.log(`✅ Successful Logins: ${activeSessions.length}`);
    console.log(`❌ Failed Logins: ${loginPromises.length - activeSessions.length}`);

    if (activeSessions.length === 0) {
      console.log('\nNo teams logged in successfully. Test concluded.');
      return;
    }

    // Step 4: Wait for the specified duration before logging out
    console.log(`\n🕒 All successful teams are now logged in. Waiting for ${TEST_DURATION_MS / 60000} minutes before logging out...`);

    setTimeout(() => {
      // Step 5: After 2 minutes, logout all active sessions
      console.log(`\n⏳ Time's up! Logging out all ${activeSessions.length} active sessions...`);
      
      const logoutPromises = activeSessions.map(session => {
        return new Promise((resolve) => {
          // Logout is simply disconnecting the socket.
          // Your server should handle the 'disconnect' event to clean up.
          session.socket.disconnect();
          console.log(`👋 LOGOUT: [${session.teamName}] has been disconnected.`);
          resolve();
        });
      });

      // Wait for all disconnection commands to be sent
      Promise.all(logoutPromises).then(() => {
        console.log('\n--- Logout Summary ---');
        console.log(`✅ All ${activeSessions.length} sessions have been instructed to log out.`);
        console.log('\n🎉 Test finished successfully!');
      });

    }, TEST_DURATION_MS);

  } catch (error) {
    console.error(`\n❌ An unexpected error occurred during the test setup: ${error.message}`);
    if (error.response?.data) {
        console.error('Server Response:', error.response.data);
    }
  }
}

// Run the main test function
runLoginLogoutTest();