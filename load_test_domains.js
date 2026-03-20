const axios = require('axios');
const BASE_URL = 'http://localhost:3001';

async function runDomainLoadTest() {
    console.log('🚀 Starting Domain Selection Load Test...');

    try {
        // 1. Fetch domains
        console.log('Fetching available domains...');
        let t0 = performance.now();
        const domainsRes = await axios.get(`${BASE_URL}/domains`);
        const allDomains = domainsRes.data;
        console.log(`✅ Fetched ${allDomains.length} domains. Time taken: ${(performance.now() - t0).toFixed(2)}ms`);

        // 2. Fetch all verified teams
        console.log('Fetching verified teams...');
        t0 = performance.now();
        const teamsRes = await axios.get(`${BASE_URL}/Hack/students`);
        // Filter teams that haven't selected a domain yet to avoid 400 errors
        const teamsToTest = teamsRes.data.teams.filter(t => t.verified && !t.Domain);
        console.log(`✅ Found ${teamsToTest.length} verified teams without a domain. Time taken: ${(performance.now() - t0).toFixed(2)}ms`);

        if (teamsToTest.length === 0) {
            console.log('No teams need domain selection. Test concluded.');
            return;
        }

        // 3. Map teams to a random available domain ID (for the payload we just need ANY valid domain ID)
        // To simulate real load, let's randomly assign a domain from the full list to each team
        // The server will handle slot decrements and race conditions
        const selectionPromises = teamsToTest.map(team => {
            // Pick a random domain
            const randomDomain = allDomains[Math.floor(Math.random() * allDomains.length)];

            const payload = {
                teamId: team._id,
                domain: randomDomain.id
            };

            return axios.post(`${BASE_URL}/Hack/updateDomain`, payload)
                .then(res => {
                    return { teamName: team.teamname, domainName: randomDomain.name, status: 'success', data: res.data };
                })
                .catch(err => {
                    return {
                        teamName: team.teamname,
                        domainName: randomDomain.name,
                        status: 'failed',
                        reason: err.response?.data?.error || err.message
                    };
                });
        });

        // 4. BLAST the server with concurrent requests!
        console.log(`\n💥 Simulating ${selectionPromises.length} teams selecting domains concurrently...\n`);
        const startTime = performance.now();
        const results = await Promise.all(selectionPromises);
        const totalTime = performance.now() - startTime;

        let successCount = 0;
        let failCount = 0;
        const failReasons = {};

        results.forEach(res => {
            if (res.status === 'success') {
                console.log(`✅ SUCCESS: [${res.teamName}] claimed "${res.domainName}"`);
                successCount++;
            } else {
                console.error(`❌ FAILED:  [${res.teamName}] tried "${res.domainName}" - Reason: ${res.reason}`);
                failCount++;
                failReasons[res.reason] = (failReasons[res.reason] || 0) + 1;
            }
        });

        console.log('\n--- Load Test Summary ---');
        console.log(`Total Requests: ${selectionPromises.length}`);
        console.log(`Concurrent Execution Time: ${totalTime.toFixed(2)}ms`);
        console.log(`✅ Successful Selections: ${successCount}`);
        console.log(`❌ Failed Selections: ${failCount}`);

        if (failCount > 0) {
            console.log('\nFailure Breakdown:');
            for (const [reason, count] of Object.entries(failReasons)) {
                console.log(`- "${reason}": ${count} times`);
            }
            console.log('\n(Note: Failures like "no slots left" are EXPECTED in a concurrent load test if multiple teams try to snatch the last slot of a domain at the exact same millisecond!)');
        }

        console.log('\n🎉 Domain load test finished. Run this script again if you want to test further (only teams without domains will be selected).');

    } catch (error) {
        console.error(`\n❌ An unexpected error occurred during test setup: ${error.message}`);
        if (error.response?.data) {
            console.error('Server Response:', error.response.data);
        }
    }
}

runDomainLoadTest();
