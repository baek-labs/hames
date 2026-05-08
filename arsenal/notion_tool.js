const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

const notion = new Client({ auth: process.env.NOTION_KEY });

const COMMANDS = {
    // Search Pages
    'search': async (query) => {
        // if (!query) throw new Error('Query required'); // Allow empty query to list all
        const response = await notion.search({
            query: query, // undefined is fine for "all"
            sort: {
                direction: 'descending',
                timestamp: 'last_edited_time',
            },
        });
        console.log(`Found ${response.results.length} results:`);
        response.results.forEach(page => {
            const title = page.properties?.Name?.title?.[0]?.plain_text ||
                page.properties?.title?.title?.[0]?.plain_text || 'Untitled';
            console.log(`- [${page.object}] ${title} (ID: ${page.id})`);
        });
    },

    // Read Page Content (Blocks)
    'read-properties': async (pageId) => {
        if (!pageId) throw new Error('Page ID required');
        try {
            const page = await notion.pages.retrieve({ page_id: pageId });
            console.log(`--- Properties (${pageId}) ---`);
            const title = page.properties?.Name?.title?.[0]?.plain_text || page.properties?.title?.title?.[0]?.plain_text || 'Untitled';
            console.log(`Title: ${title}`);
            for (const [key, value] of Object.entries(page.properties)) {
                let valStr = 'unknown';
                if (value.type === 'number') valStr = value.number;
                else if (value.type === 'select') valStr = value.select?.name;
                else if (value.type === 'status') valStr = value.status?.name;
                else if (value.type === 'date') valStr = value.date?.start;
                else if (value.type === 'rich_text') valStr = value.rich_text.map(t => t.plain_text).join('');
                else if (value.type === 'title') valStr = value.title.map(t => t.plain_text).join('');
                console.log(`${key}: ${valStr}`);
            }
        } catch (e) { console.log(e.message); }
    },

    'read-page': async (pageId) => {
        if (!pageId) throw new Error('Page ID required');
        console.log(`--- Page Content (${pageId}) ---`);
        await recursiveRead(pageId);
        console.log('--------------------------------');
    },

    // Create Page
    'create-page': async (parentId, title) => {
        if (!parentId || !title) throw new Error('Usage: create-page [ParentPageID] [Title]');
        const response = await notion.pages.create({
            parent: { page_id: parentId },
            properties: {
                title: [
                    {
                        text: {
                            content: title,
                        },
                    },
                ],
            },
        });
        console.log(`✅ Page Created! ID: ${response.id}`);
        console.log(`URL: ${response.url}`);
    },

    // Append Block (Edit)
    'append-block': async (pageId, content) => {
        if (!pageId || !content) throw new Error('Usage: append-block [PageID] [Content]');
        const response = await notion.blocks.children.append({
            block_id: pageId,
            children: [
                {
                    object: 'block',
                    type: 'paragraph',
                    paragraph: {
                        rich_text: [
                            {
                                type: 'text',
                                text: {
                                    content: content,
                                },
                            },
                        ],
                    },
                },
            ],
        });
        console.log(`✅ Content Appended to Page ${pageId}`);
    },

    // Update Database Property
    'update-property': async (pageId, propertyName, value, type) => {
        if (!pageId || !propertyName || value === undefined) throw new Error('Usage: update-property [PageID] [PropertyName] [Value] [Type(number/rich_text/select)]');
        const properties = {};
        if (type === 'number') properties[propertyName] = { number: parseFloat(value) };
        else if (type === 'select') properties[propertyName] = { select: { name: value } };
        else properties[propertyName] = { rich_text: [{ text: { content: value } }] };

        await notion.pages.update({
            page_id: pageId,
            properties: properties
        });
        console.log(`✅ Updated ${propertyName} for Page ${pageId}`);
    },

    // Query Database for Blanks
    'query-db': async (dbId) => {
        if (!dbId) throw new Error('Usage: query-db [DatabaseID]');
        const response = await notion.databases.query({ database_id: dbId });
        console.log(JSON.stringify(response.results, null, 2));
    }
};

async function recursiveRead(blockId, depth = 0) {
    const indent = '  '.repeat(depth);
    try {
        const response = await notion.blocks.children.list({ block_id: blockId, page_size: 100 });
        for (const block of response.results) {
            const type = block.type;
            let text = '';

            // Handle common text-bearing blocks
            if (['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'callout', 'toggle'].includes(type)) {
                text = block[type].rich_text ? block[type].rich_text.map(t => t.plain_text).join('') : '';

                let prefix = '';
                if (type === 'heading_1') prefix = '# ';
                if (type === 'heading_2') prefix = '## ';
                if (type === 'heading_3') prefix = '### ';
                if (type === 'bulleted_list_item') prefix = '- ';
                if (type === 'numbered_list_item') prefix = '1. ';
                if (type === 'quote') prefix = '> ';
                if (type === 'callout') prefix = '💡 ';
                if (type === 'toggle') prefix = '▶ ';

                if (text || type === 'paragraph') { // Print paragraphs even if empty
                    console.log(`${indent}${prefix}${text}`);
                }

                // Recursively read children if applicable (e.g. toggles, quotes, callouts can have children)
                if (block.has_children) {
                    await recursiveRead(block.id, depth + 1);
                }
            }
            // Handle Structural Blocks
            else if (['column_list', 'column'].includes(type)) {
                // console.log(`${indent}[${type}]`); // Reduce noise
                await recursiveRead(block.id, depth + 1);
            }
            // Handle Database/Child Page
            else if (type === 'child_database') {
                const title = block.child_database.title || 'Untitled Database';
                console.log(`${indent}📂 [Database: ${title}] (ID: ${block.id})`);
                await queryDatabase(block.id, depth + 1);
            }
            else if (type === 'child_page') {
                const title = block.child_page.title;
                console.log(`${indent}📄 [Page: ${title}] (ID: ${block.id})`);
            }
            // Handle Tables
            else if (type === 'table') {
                console.log(`${indent}📋 [Table]`);
                await recursiveRead(block.id, depth + 1);
            }
            else if (type === 'table_row') {
                const cells = block.table_row.cells.map(cell => cell.map(t => t.plain_text).join(''));
                console.log(`${indent}| ${cells.join(' | ')} |`);
            }
            // Handle Images
            else if (type === 'image') {
                const caption = block.image.caption?.map(t => t.plain_text).join('') || '';
                const url = block.image.type === 'external' ? block.image.external.url : 'internal-file-url';
                console.log(`${indent}🖼️ [Image: ${caption}](${url})`);
            }
            else if (type === 'divider') {
                console.log(`${indent}---`);
            }
            else {
                console.log(`${indent}[${type}]`);
            }
        }
    } catch (e) {
        console.log(`${indent}⚠️ [Error reading children of ${blockId}: ${e.message}]`);
    }
}

async function queryDatabase(dbId, depth) {
    const indent = '  '.repeat(depth);
    try {
        const response = await notion.databases.query({ database_id: dbId });
        console.log(`${indent}[Database: ${response.results.length} items]`);
        for (const page of response.results) {
            const title = page.properties?.Name?.title?.[0]?.plain_text || page.properties?.title?.title?.[0]?.plain_text || 'Untitled';
            console.log(`${indent}- ${title}`);
            for (const [key, value] of Object.entries(page.properties)) {
                let valStr = '';
                if (value.type === 'number') valStr = value.number;
                else if (value.type === 'select') valStr = value.select?.name;
                else if (value.type === 'status') valStr = value.status?.name;
                else if (value.type === 'date') valStr = value.date?.start;
                else if (value.type === 'rich_text') valStr = value.rich_text.map(t => t.plain_text).join('');
                else continue; // Skip complex types for brevity
                if (valStr !== undefined && valStr !== '') console.log(`${indent}  ${key}: ${valStr}`);
            }
        }
    } catch (e) {
        console.log(`${indent}[Error querying database ${dbId}: ${e.message}]`);
    }
}

async function main() {
    const [, , command, ...args] = process.argv;

    if (!COMMANDS[command]) {
        console.log('Usage: node notion_tool.js [search|read-page|create-page|append-block] [args]');
        return;
    }

    try {
        await COMMANDS[command](...args);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();
