const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

// Credentials
const SCOPES = [
    'https://www.googleapis.com/auth/calendar', // Changed to full access
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/presentations', // Added for Slides
    'https://www.googleapis.com/auth/youtube.readonly' // Added for YouTube
];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const MAPS_KEY = process.env.GOOGLE_MAPS_KEY;

// --- Authentication Helper ---
async function authorize() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error('Error: credentials.json not found in scripts folder.');
        process.exit(1);
    }
    const content = fs.readFileSync(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    // Handle different json structures
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    if (fs.existsSync(TOKEN_PATH)) {
        const token = fs.readFileSync(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } else {
        return await getNewToken(oAuth2Client);
    }
}

async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question('Enter the code from that page here: ', (code) => {
            rl.close();
            oAuth2Client.getToken(code, (err, token) => {
                if (err) return console.error('Error retrieving access token', err);
                oAuth2Client.setCredentials(token);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
                console.log('Token stored to', TOKEN_PATH);
                resolve(oAuth2Client);
            });
        });
    });
}

// --- Commands ---
const COMMANDS = {
    // Google Maps (Using Places API New v1)
    'places-search': async (query) => {
        if (!MAPS_KEY) {
            console.error("Error: GOOGLE_MAPS_KEY not found in .env");
            return;
        }
        const data = JSON.stringify({ textQuery: query });
        const options = {
            hostname: 'places.googleapis.com',
            path: '/v1/places:searchText',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': MAPS_KEY,
                'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
                'Content-Length': data.length
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (response.places && response.places.length > 0) {
                        console.log(`Found places for "${query}":`);
                        response.places.slice(0, 5).forEach((place, i) => {
                            const name = place.displayName ? place.displayName.text : 'Unknown';
                            console.log(`${i + 1}. ${name}`);
                            console.log(`   addr: ${place.formattedAddress}`);
                        });
                    } else if (response.error) {
                        console.error("API Error:", response.error.message);
                    } else {
                        console.log("No places found.");
                    }
                } catch (e) {
                    console.error("Error parsing response:", e.message);
                }
            });
        });
        req.on('error', (e) => console.error("Request Error:", e.message));
        req.write(data);
        req.end();
    },

    // Drive
    'drive-search': async (query) => {
        const auth = await authorize();
        const drive = google.drive({ version: 'v3', auth });
        try {
            const res = await drive.files.list({
                q: `name contains '${query}' and trashed = false`,
                pageSize: 10,
                fields: 'nextPageToken, files(id, name, mimeType)',
            });
            const files = res.data.files;
            if (files && files.length) {
                console.log('Files:');
                files.map((file) => console.log(`${file.name} (${file.id})`));
            } else {
                console.log('No files found.');
            }
        } catch (err) { console.log('API Error: ' + err); }
    },
    'yt-search': async (query) => {
        if (!query) { console.log('Usage: yt-search "query"'); return; }
        const auth = await authorize();
        const youtube = google.youtube({ version: 'v3', auth });
        try {
            console.log(`Searching YouTube for: ${query}...`);
            const res = await youtube.search.list({
                part: 'snippet',
                q: query,
                type: 'video',
                maxResults: 5
            });
            const videos = res.data.items;
            if (videos && videos.length) {
                console.log('Found videos:');
                videos.forEach((video, i) => {
                    console.log(`${i + 1}. ${video.snippet.title}`);
                    console.log(`   Link: https://www.youtube.com/watch?v=${video.id.videoId}`);
                });
            } else { console.log('No videos found.'); }
        } catch (err) { console.error('YouTube API Error:', err.message); }
    },
    'drive-upload': async (filePath, folderName) => {
        if (!filePath) { console.log('Usage: drive-upload "path/to/file" "Folder Name"'); return; }
        const auth = await authorize();
        const drive = google.drive({ version: 'v3', auth });

        try {
            const fileName = path.basename(filePath);
            let folderId = null;

            // 1. Find folder if specified
            if (folderName) {
                const res = await drive.files.list({
                    q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
                    fields: 'files(id, name)',
                });
                if (res.data.files.length > 0) {
                    folderId = res.data.files[0].id;
                    console.log(`Found folder: ${folderName} (${folderId})`);
                } else {
                    console.log(`Folder '${folderName}' not found. Uploading to root.`);
                }
            }

            // 2. Upload file
            const fileMetadata = {
                name: fileName,
                parents: folderId ? [folderId] : []
            };
            const media = {
                mimeType: 'application/octet-stream', // Let Drive infer or generic
                body: fs.createReadStream(filePath)
            };

            const file = await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, webViewLink'
            });

            console.log(`✅ File Uploaded: ${file.data.name}`);
            console.log(`Link: ${file.data.webViewLink}`);

        } catch (err) { console.error('Error uploading file:', err.message); }
    },

    // Calendar: List, Create
    'cal-list': async () => {
        const auth = await authorize();
        const calendar = google.calendar({ version: 'v3', auth });
        try {
            const res = await calendar.events.list({
                calendarId: 'primary',
                timeMin: (new Date()).toISOString(),
                maxResults: 10,
                singleEvents: true,
                orderBy: 'startTime',
            });
            const events = res.data.items;
            if (events && events.length) {
                console.log('Upcoming events:');
                events.map((event) => {
                    const start = event.start.dateTime || event.start.date;
                    console.log(`${start} - ${event.summary}`);
                });
            } else { console.log('No upcoming events found.'); }
        } catch (err) { console.log('API Error: ' + err); }
    },
    'cal-create': async (summary, startTime) => {
        if (!summary || !startTime) { console.log('Usage: cal-create "Meeting" "2024-01-25T10:00:00Z"'); return; }
        const auth = await authorize();
        const calendar = google.calendar({ version: 'v3', auth });
        const start = new Date(startTime);
        const end = new Date(start.getTime() + 60 * 60 * 1000); // Default 1 hour
        try {
            const event = {
                summary: summary,
                start: { dateTime: start.toISOString() },
                end: { dateTime: end.toISOString() },
            };
            const res = await calendar.events.insert({
                calendarId: 'primary',
                resource: event,
            });
            console.log(`✅ Event created: ${res.data.htmlLink}`);
        } catch (err) { console.error('Error creating event:', err); }
    },

    // Gmail: Read, Send, Draft
    'mail-read': async (query) => {
        const auth = await authorize();
        const gmail = google.gmail({ version: 'v1', auth });
        try {
            const q = query || 'from:"{{CEO_NAME}}"';
            console.log(`Searching emails for: ${q}...`);
            const res = await gmail.users.messages.list({ userId: 'me', q: q, maxResults: 5 });
            const messages = res.data.messages;
            if (messages && messages.length) {
                console.log(`Found ${messages.length} email(s):`);
                for (const msg of messages) {
                    const m = await gmail.users.messages.get({ userId: 'me', id: msg.id });
                    const headers = m.data.payload.headers;
                    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
                    const from = headers.find(h => h.name === 'From')?.value || '(Unknown)';
                    const date = headers.find(h => h.name === 'Date')?.value || '';
                    console.log(`[${date}] ${from}: ${subject}`);
                }
            } else { console.log('No matching emails found.'); }
        } catch (err) { console.error('Gmail Error:', err.message); }
    },
    'mail-send': async (to, subject, body) => {
        if (!to || !subject || !body) { console.log('Usage: mail-send "to" "sub" "body"'); return; }
        const auth = await authorize();
        const gmail = google.gmail({ version: 'v1', auth });
        const str = [`To: ${to}`, 'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', `Subject: ${subject}`, '', body].join('\n');
        const raw = Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        try {
            const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: raw } });
            console.log(`✅ Email Sent! ID: ${res.data.id}`);
        } catch (err) { console.error('Error sending email:', err.message); }
    },
    'mail-draft': async (to, subject, body) => {
        if (!to || !subject || !body) { console.log('Usage: mail-draft "to" "sub" "body"'); return; }
        const auth = await authorize();
        const gmail = google.gmail({ version: 'v1', auth });
        const str = [`To: ${to}`, 'Content-Type: text/plain; charset=utf-8', 'MIME-Version: 1.0', `Subject: ${subject}`, '', body].join('\n');
        const raw = Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        try {
            const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: raw } } });
            console.log(`✅ Draft Created! ID: ${res.data.id}`);
        } catch (err) { console.error('Error creating draft:', err.message); }
    },

    // Docs: Create, Append, Read
    'doc-create': async (title) => {
        const auth = await authorize();
        const drive = google.drive({ version: 'v3', auth });
        try {
            const res = await drive.files.create({
                requestBody: { name: title || 'Untitled AI Doc', mimeType: 'application/vnd.google-apps.document' },
                fields: 'id, name, webViewLink'
            });
            console.log(`✅ Document Created: ${res.data.name} (ID: ${res.data.id})`);
            console.log(`Link: ${res.data.webViewLink}`);
        } catch (err) { console.error('Error creating doc:', err); }
    },
    'doc-read': async (docId) => {
        if (!docId) { console.log('Usage: doc-read "DOC_ID"'); return; }
        const auth = await authorize();
        const docs = google.docs({ version: 'v1', auth });
        try {
            const res = await docs.documents.get({ documentId: docId });
            console.log(`--- Document: ${res.data.title} ---`);
            const content = res.data.body.content;
            content.forEach(elem => {
                if (elem.paragraph) {
                    const text = elem.paragraph.elements.map(e => e.textRun?.content).join('');
                    console.log(text);
                }
            });
            console.log('-----------------------------------');
        } catch (err) { console.error('Error reading doc:', err.message); }
    },
    'doc-append': async (docId, text) => {
        if (!docId || !text) { console.log('Usage: doc-append "DOC_ID" "Text to append"'); return; }
        const auth = await authorize();
        const docs = google.docs({ version: 'v1', auth });
        try {
            await docs.documents.batchUpdate({
                documentId: docId,
                requestBody: {
                    requests: [{
                        insertText: {
                            text: text + '\n',
                            endOfSegmentLocation: { segmentId: '' } // Appends to body
                        }
                    }]
                }
            });
            console.log(`✅ Text Appended to Doc ${docId}`);
        } catch (err) { console.error('Error appending doc:', err.message); }
    },

    // Sheets: Create, Read, Write (Append)
    'sheet-create': async (title) => {
        const auth = await authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        try {
            const res = await sheets.spreadsheets.create({
                requestBody: { properties: { title: title || 'Untitled AI Sheet' } }
            });
            console.log(`✅ Sheet Created: ${res.data.properties.title} (ID: ${res.data.spreadsheetId})`);
            console.log(`Link: ${res.data.spreadsheetUrl}`);
        } catch (err) { console.error('Error creating sheet:', err); }
    },
    'sheet-metadata': async (spreadsheetId) => {
        const auth = await authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        try {
            const res = await sheets.spreadsheets.get({ spreadsheetId });
            console.log(`Title: ${res.data.properties.title}`);
            res.data.sheets.forEach(s => {
                console.log(`Sheet: "${s.properties.title}" (ID: ${s.properties.sheetId})`);
            });
        } catch (err) { console.error('Error getting metadata:', err.message); }
    },
    'sheet-read': async (sheetId, range) => {
        if (!sheetId || !range) { console.log('Usage: sheet-read "SHEET_ID" "Sheet1!A1:B10"'); return; }
        const auth = await authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        try {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: range });
            const rows = res.data.values;
            if (rows && rows.length) {
                console.log('--- Sheet Data ---');
                rows.forEach(row => console.log(row.join('\t')));
            } else { console.log('No data found.'); }
        } catch (err) { console.error('Error reading sheet:', err.message); }
    },
    'sheet-write': async (sheetId, range, values) => {
        // values should be JSON string of array of arrays
        if (!sheetId || !range || !values) { console.log('Usage: sheet-write "SHEET_ID" "Sheet1!A1" "[[\"Val1\", \"Val2\"]]"'); return; }
        const auth = await authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        try {
            const valArray = JSON.parse(values);
            await sheets.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range: range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: valArray }
            });
            console.log(`✅ Data Written to Sheet ${sheetId}`);
        } catch (err) { console.error('Error writing sheet:', err.message); }
    },

    // Slides: Create (Basic)
    'slide-create': async (title) => {
        const auth = await authorize();
        const slides = google.slides({ version: 'v1', auth });
        try {
            const res = await slides.presentations.create({
                requestBody: { title: title || 'Untitled AI Presentation' }
            });
            console.log(`✅ Presentation Created: ${res.data.title} (ID: ${res.data.presentationId})`);
            console.log(`Link: https://docs.google.com/presentation/d/${res.data.presentationId}`);
        } catch (err) { console.error('Error creating slides:', err.message); }
    }
};

async function main() {
    const [, , command, ...args] = process.argv;
    if (command === 'places-search') {
        await COMMANDS[command](args.join(' '));
        return;
    }
    if (COMMANDS[command]) {
        // Handle args more greedily for certain commands if needed, 
        // but robust arg parsing is better done with libraries. 
        // For now, basic spreading works for quoted args.
        await COMMANDS[command](...args);
    } else {
        const cmds = Object.keys(COMMANDS).join('|');
        console.log(`Usage: node google_tool.js [${cmds}] [args]`);
    }
}

main();
