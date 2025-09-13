const axios = require('axios');
const { io } = require('socket.io-client');

// --- CONFIGURATION ---
// IMPORTANT: Change this to your live server URL when testing in production
//const BASE_URL = 'https://scorecraft-backend-73gb.onrender.com';
const BASE_URL = 'http://localhost:3001';

async function runDomainSelectionTest() {
  console.log('🚀 Starting domain selection load test...');

  try {
    // Step 1: Fetch all verified teams and available domains
    console.log('Fetching initial data from server...');
    const [teamsRes, domainsRes] = await Promise.all([
      axios.get(`${BASE_URL}/Hack/students`),
      axios.get(`${BASE_URL}/domains`)
    ]);

    // Filter for teams that are verified and haven't selected a domain yet
    const teamsToTest = teamsRes.data.teams.filter(t => t.verified && !t.Domain);
    const availableDomains = domainsRes.data.filter(d => d.slots > 0);

    if (teamsToTest.length === 0) {
      console.error('❌ No verified teams without a domain were found. Test cannot proceed.');
      return;
    }
    if (availableDomains.length === 0) {
        console.error('❌ No domains with available slots were found. Test cannot proceed.');
        return;
    }
    
    console.log(`✅ Found ${teamsToTest.length} teams ready to select a domain.`);
    console.log(`✅ Found ${availableDomains.length} unique domains with open slots.`);

    // Step 2: Assign a random available domain to each team for the test
    const assignments = teamsToTest.map(team => ({
      teamId: team._id,
      teamName: team.teamname,
      password: team.password,
      domainId: availableDomains[Math.floor(Math.random() * availableDomains.length)].id,
    }));

    // Step 3: Create a login and domain selection promise for each team
    const testPromises = assignments.map(assignment => {
      return new Promise((resolve, reject) => {
        const socket = io(BASE_URL, {
          transports: ['websocket'],
          forceNew: true,
        });

        const timeout = setTimeout(() => {
          socket.disconnect();
          reject({ ...assignment, reason: 'Test timed out after 15 seconds.' });
        }, 15000); // 15-second timeout

        socket.on('connect', () => {
          // First, log in via HTTP
          axios.post(`${BASE_URL}/Hack/team/${assignment.password}`)
            .then(res => {
              // Then, establish a socket session
              socket.emit('team:login', res.data._id);
            })
            .catch(err => {
              clearTimeout(timeout);
              socket.disconnect();
              reject({ ...assignment, reason: `HTTP login failed: ${err.response?.data?.message || err.message}` });
            });
        });

        socket.on('login:success', () => {
          // Now that the session is active, attempt to select the domain
          socket.emit('domainSelected', {
            teamId: assignment.teamId,
            domain: assignment.domainId,
          });
        });

        // Step 4: Listen for the final result of the domain selection
        socket.on('domainSelected', (response) => {
          clearTimeout(timeout);
          socket.disconnect();
          if (response.error) {
            reject({ ...assignment, reason: `Domain selection failed: ${response.error}` });
          } else {
            resolve({ ...assignment, result: `Successfully selected ${response.domain.name}` });
          }
        });

        // Handle connection and login errors
        socket.on('login:error', (data) => {
          clearTimeout(timeout);
          socket.disconnect();
          reject({ ...assignment, reason: `Session error: ${data.message}` });
        });

        socket.on('connect_error', (err) => {
          clearTimeout(timeout);
          reject({ ...assignment, reason: `Connection error: ${err.message}` });
        });
      });
    });

    // Step 5: Execute all tests simultaneously and report results
    console.log(`\n💥 Simulating ${testPromises.length} teams selecting domains now...\n`);
    const results = await Promise.allSettled(testPromises);

    let successCount = 0;
    let failureCount = 0;

    console.log('--- Domain Selection Test Results ---');
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        console.log(`✅ SUCCESS: [${result.value.teamName}] - ${result.value.result}`);
        successCount++;
      } else {
        console.error(`❌ FAILED: [${result.reason.teamName}] - ${result.reason.reason}`);
        failureCount++;
      }
    });

    console.log('\n--- Summary ---');
    console.log(`Total Attempts: ${testPromises.length}`);
    console.log(`✅ Successes: ${successCount}`);
    console.log(`❌ Failures: ${failureCount}`);
    console.log('\nTest finished. Please check your admin panel and database to verify the final domain assignments and slot counts.');

  } catch (error) {
    console.error(`\n❌ An unexpected error occurred during the test setup: ${error.message}`);
  }
}

runDomainSelectionTest();