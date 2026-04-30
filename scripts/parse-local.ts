import 'dotenv/config';
import fs from 'fs';
import path from 'path';
const pdfParse = require('pdf-parse');
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY is not defined in environment variables');
}
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const RIGS_DIR = path.join(__dirname, '../src/rigs');
const MANUALS_DIR = path.join(__dirname, 'manuals');

if (!fs.existsSync(RIGS_DIR)) fs.mkdirSync(RIGS_DIR, { recursive: true });

// Helper to prevent 429 rate limits on the free tier
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const PROCESSED_DIR = path.join(__dirname, 'processed manuals');
if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });

async function extractDMXProfile(pdfText: string, fileName: string) {
  const prompt = `
You are an expert lighting technician. I will provide you with the text from a lighting fixture manual.
Your task is to extract the DMX channel modes (personalities) and their channel mappings.

Output ONLY valid JSON matching this exact structure:
{
  "id": "slug-format-based-on-filename",
  "brand": "AYRA",
  "model": "Model Name",
  "defaultPersonality": "name of the most comprehensive channel mode",
  "personalities": [
    {
      "name": "e.g., 4-channel mode",
      "channelCount": 4,
      "channels": [
        { 
           "offset": 0, 
           "name": "Red", 
           "type": "red", 
           "minValue": 0, 
           "maxValue": 255, 
           "defaultValue": 0,
           "notes": "Optional notes"
        }
      ]
    }
  ]
}

Rules:
1. Ensure 'offset' is strictly 0-indexed (Channel 1 has offset 0).
2. If there are multiple channel modes (e.g., 4CH, 8CH), create a personality for each.
3. Allowed types: dimmer, color-wheel, strobe, red, green, blue, white, pan, tilt, macro, speed, other.
4. Output nothing but the raw JSON object. Do not wrap in markdown \`\`\`json blocks, just the raw braces.

Filename: ${fileName}
Manual Text:
---
${pdfText.substring(0, 80000)}
---
`;

  try {
    console.log(`[AI] Asking Gemini to extract DMX profile for ${fileName}...`);
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    text = text.replace(/^```json/m, '').replace(/^```/m, '').trim();
    
    return JSON.parse(text);
  } catch (err) {
    console.error(`[AI] Error parsing profile for ${fileName}:`, err);
    return null;
  }
}

async function run() {
  console.log('Starting Local Manual Parser...');
  
  if (!fs.existsSync(MANUALS_DIR)) {
    console.log('Manuals directory not found!');
    return;
  }

  const files = fs.readdirSync(MANUALS_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  console.log(`Found ${files.length} PDFs to process.`);

  for (const file of files) {
    const filePath = path.join(MANUALS_DIR, file);
    console.log(`\nProcessing: ${file}`);
    
    try {
      const buffer = fs.readFileSync(filePath);
      
      console.log('  Parsing PDF text...');
      const pdfData = await pdfParse(buffer);
      const rawText = pdfData.text;
      
      if (!rawText || rawText.length < 100) {
        console.log('  PDF contained no readable text (might be scanned images).');
        continue;
      }
      
      const fixtureData = await extractDMXProfile(rawText, file);
      
      if (fixtureData && fixtureData.id) {
        const outFileName = fixtureData.id.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
        const outFilePath = path.join(RIGS_DIR, outFileName);
        
        fs.writeFileSync(outFilePath, JSON.stringify(fixtureData, null, 2));
        console.log(`  ✅ Successfully saved rig profile to src/rigs/${outFileName}`);
        
        // Move processed file
        const processedFilePath = path.join(PROCESSED_DIR, file);
        fs.renameSync(filePath, processedFilePath);
        console.log(`  📦 Moved ${file} to processed manuals/`);
      }

      console.log('  Sleeping 10 seconds to respect API rate limits...');
      await sleep(10000);

    } catch (err) {
      console.error(`  ❌ Error processing ${file}:`, err);
    }
  }

  console.log('\nParsing run complete.');
}

run().catch(console.error);
