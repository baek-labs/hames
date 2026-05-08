process.stdout.setEncoding('utf8');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envConfig = require('dotenv').config({ path: envPath });
}

const API_KEY = process.env.PERPLEXITY_API_KEY;

if (!API_KEY) {
    console.error('Error: PERPLEXITY_API_KEY not found in .env');
    process.exit(1);
}

const query = process.argv[2];

if (!query) {
    console.log('Usage: node perplexity_tool.js "<query>"');
    process.exit(0);
}

const data = JSON.stringify({
    model: 'sonar-reasoning-pro',
    messages: [
        { role: 'system', content: 'You are a helpful market research assistant. Provide detailed answers with citations.' },
        { role: 'user', content: query }
    ]
});

const options = {
    hostname: 'api.perplexity.ai',
    path: '/chat/completions',
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
    }
};

console.log(`Searching Perplexity for: "${query}"...`);

const outFile = process.argv[3] || null;

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        try {
            const response = JSON.parse(body);
            if (response.choices && response.choices.length > 0) {
                const content = response.choices[0].message.content;
                const citations = response.citations ? '\n\nCitations:\n' + response.citations.join('\n') : '';
                const output = '\n--- Perplexity Answer ---\n\n' + content + citations + '\n\n-------------------------\n';
                if (outFile) {
                    fs.writeFileSync(outFile, output, 'utf8');
                    console.log('Saved to:', outFile);
                } else {
                    process.stdout.write(output);
                }
            } else {
                console.error('Error: No response or invalid format', response);
            }
        } catch (e) {
            console.error('Error parsing response:', e.message);
            console.error('Raw Body:', body);
        }
    });
});

req.on('error', (e) => {
    console.error('Request Error:', e.message);
});

req.write(data);
req.end();
