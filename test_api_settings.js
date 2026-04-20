const fetch = require('node-fetch');

async function test() {
    try {
        const res = await fetch('http://localhost:3001/api/webhooks/settings');
        const data = await res.json();
        console.log('API RESPONSE mockup_templates type:', typeof data.mockup_templates);
        console.log('API RESPONSE mockup_templates:', JSON.stringify(data.mockup_templates, null, 2));
    } catch (e) {
        console.error(e);
    }
}

test();
