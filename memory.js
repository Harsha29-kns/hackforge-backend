const axios = require('axios');
const { io } = require('socket.io-client');
const { performance } = require('perf_hooks');

// --- CONFIGURATION ---
const BASE_URL = 'https://scorecraft-backend-73gb.onrender.com'; // Ensure your server is running here
const TEST_DURATION_SECONDS = 60; // How long to keep all users active (in seconds)
const REQUEST_INTERVAL_MS = 5000; // How often each user requests data (in milliseconds)

// --- HELPER FUNCTIONS ---
function formatMemoryUsage(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function printMemoryUsage(label) {
  const usage = process.memoryUsage();
  console.log(`--- ${label} ---`);
  console.log(`  RSS (Total Memory):         ${formatMemoryUsage(usage.rss)}`);
  console.log(`  Heap Total (Allocated):     ${formatMemoryUsage(usage.heapTotal)}`);
  console.log(`  Heap Used (Currently Used): ${formatMemoryUsage(usage.heapUsed)}`);
  console.log('---------------------------------\n');
}

// --- MAIN TEST SCRIPT ---
async function runLoadTest() {
  console.log('🚀 Starting Backend Load and Memory Test...');
  printMemoryUsage('Initial Server State');

  let allTeams = [];
  try {
    const response = await axios.get(`${BASE_URL}/Hack/students`);
    allTeams = response.data.teams.filter(t => t.verified && t.password);
    if (allTeams.length === 0) {
      console.error('❌ No verified teams with passwords found. Cannot run the test.');
      return;
    }
    console.log(`✅ Fetched ${allTeams.length} verified teams for the test.`);
  } catch (error) {
    console.error(`❌ Failed to fetch teams: ${error.message}`);
    return;
  }

  const activeSockets = [];
  const loginPromises = allTeams.map(team =>
    new Promise((resolve, reject) => {
      const socket = io(BASE_URL, {
        transports: ['websocket'],
        forceNew: true,
      });

      const timeout = setTimeout(() => {
        socket.disconnect();
        reject(`[${team.teamname}] Login timed out.`);
      }, 10000);

      socket.on('connect', () => {
        axios.post(`${BASE_URL}/Hack/team/${team.password}`)
          .then(res => socket.emit('team:login', res.data._id))
          .catch(err => {
            clearTimeout(timeout);
            socket.disconnect();
            reject(`[${team.teamname}] HTTP login failed.`);
          });
      });

      socket.on('login:success', () => {
        clearTimeout(timeout);
        activeSockets.push({ socket, teamName: team.teamname });
        resolve(`[${team.teamname}] Login successful.`);
      });

      socket.on('login:error', (data) => {
        clearTimeout(timeout);
        socket.disconnect();
        reject(`[${team.teamname}] Session Error: ${data.message}`);
      });
    })
  );

  console.log('\n- Simulating all teams logging in...');
  const loginResults = await Promise.allSettled(loginPromises);
  const successfulLogins = loginResults.filter(r => r.status === 'fulfilled').length;
  console.log(`- ${successfulLogins} of ${allTeams.length} teams logged in successfully.`);

  printMemoryUsage(`After ${successfulLogins} Concurrent Logins`);

  if (successfulLogins === 0) {
      console.log('No teams logged in. Ending test.');
      return;
  }

  console.log(`- Keeping users active and making requests for ${TEST_DURATION_SECONDS} seconds...`);
  const testEndTime = performance.now() + TEST_DURATION_SECONDS * 1000;

  // Simulate users fetching data periodically
  const requestInterval = setInterval(() => {
    console.log(`- All ${successfulLogins} active users are fetching /Hack/students...`);
    activeSockets.forEach(({ socket }) => {
        axios.get(`${BASE_URL}/Hack/students`).catch(err => {});
    });
    printMemoryUsage('During Active Load');
  }, REQUEST_INTERVAL_MS);


  // Wait for the test duration to complete
  await new Promise(resolve => setTimeout(resolve, TEST_DURATION_SECONDS * 1000));

  clearInterval(requestInterval);

  console.log('\n- Disconnecting all users...');
  activeSockets.forEach(({ socket }) => socket.disconnect());

  // Wait a moment for the server to process disconnections and for garbage collection
  await new Promise(resolve => setTimeout(resolve, 5000));

  printMemoryUsage('Final State (After Disconnect)');
  console.log('✅ Test complete.');
}

runLoadTest();