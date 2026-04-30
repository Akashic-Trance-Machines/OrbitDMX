import 'dotenv/config';
import puppeteer from 'puppeteer';
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
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); // Use flash for high free-tier rate limits

const RIGS_DIR = path.join(__dirname, '../src/rigs');
if (!fs.existsSync(RIGS_DIR)) fs.mkdirSync(RIGS_DIR, { recursive: true });

// Helper to prevent 429 rate limits on the free tier
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function extractDMXProfile(pdfText: string, productName: string) {
  const prompt = `
You are an expert lighting technician. I will provide you with the text from a lighting fixture manual.
Your task is to extract the DMX channel modes (personalities) and their channel mappings.

Product Name: ${productName}

Output ONLY valid JSON matching this exact TypeScript interface:
\`\`\`typescript
interface Rig {
  id: string; // generate a slug like "ayra-compar-kit-3"
  manufacturer: string; // "Ayra"
  model: string; // e.g., "Compar Kit 3"
  personalities: {
    name: string; // e.g., "4-channel", "18-channel RGBW"
    channelCount: number;
    channels: {
      offset: number; // 0-indexed offset (0 for CH1, 1 for CH2, etc.)
      type: "dimmer" | "color" | "pan" | "tilt" | "strobe" | "macro" | "speed" | "other";
      description: string; // e.g., "Master dimmer 0-100%", "Red LED 1"
    }[];
  }[];
}
\`\`\`

Rules:
1. Ensure 'offset' is strictly 0-indexed (Channel 1 has offset 0).
2. If there are multiple channel modes (e.g., 4CH, 8CH), create a personality for each.
3. Output nothing but the raw JSON object. Do not wrap in markdown \`\`\`json blocks, just the raw braces.

Manual Text:
---
${pdfText.substring(0, 50000)} // Truncated if extremely long, but 50k chars is plenty for Gemini 1.5
---
`;

  try {
    console.log(`[AI] Asking Gemini to extract DMX profile for ${productName}...`);
    const result = await model.generateContent(prompt);
    let text = result.response.text();
    // Clean markdown formatting if Gemini includes it
    text = text.replace(/^```json/m, '').replace(/^```/m, '').trim();
    
    return JSON.parse(text);
  } catch (err) {
    console.error(`[AI] Error parsing profile for ${productName}:`, err);
    return null;
  }
}

async function run() {
  console.log('Starting Ayra Manual Scraper...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set User-Agent to avoid basic bot blocks
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const searchUrl = 'https://www.bax-shop.be/nl/par-spots/ayra';
  console.log(`Navigating to ${searchUrl}`);
  
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

  // Get product links (this selector might need tweaking based on bax-shop's actual DOM)
  console.log('Extracting product links...');
  const productLinks = await page.$$eval('a', anchors => {
    return anchors
      .map(a => a.href)
      .filter(href => href.includes('/ayra-') && !href.includes('#') && !href.includes('review'))
      .filter((value, index, self) => self.indexOf(value) === index); // unique
  });

  console.log(`Found ${productLinks.length} potential Ayra product pages.`);
  
  // For safety, let's just do the first 5 in this run to avoid banning/overload
  const linksToProcess = productLinks.slice(0, 5);
  
  for (const link of linksToProcess) {
    console.log(`\nVisiting: ${link}`);
    try {
      await page.goto(link, { waitUntil: 'domcontentloaded' });
      
      const productName = await page.$eval('h1', h1 => h1.textContent?.trim() || 'Unknown Ayra Product').catch(() => 'Unknown Ayra Product');
      
      // Look for PDF links that look like manuals
      const pdfUrls = await page.$$eval('a', anchors => 
        anchors.map(a => a.href).filter(href => {
          const lower = href.toLowerCase();
          return lower.endsWith('.pdf') && (lower.includes('manual') || lower.includes('handleiding'));
        })
      );
      
      if (pdfUrls.length === 0) {
        console.log(`  No PDF manuals found for ${productName}`);
        continue;
      }

      // Prefer English manual if available
      const manualUrl = pdfUrls.find(url => url.toLowerCase().includes('_en') || url.toLowerCase().includes('manual_en')) || pdfUrls[0];
      console.log(`  Found manual: ${manualUrl}`);
      
      // Download PDF
      console.log('  Downloading PDF...');
      const response = await fetch(manualUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        }
      });
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Check if it's actually a PDF
      if (buffer.toString('utf-8', 0, 5) !== '%PDF-') {
        console.log('  ❌ Downloaded file is not a valid PDF (likely blocked by Cloudflare/Bot-protection). Skipping.');
        continue;
      }
      
      // Parse PDF
      console.log('  Parsing PDF text...');
      const pdfData = await pdfParse(buffer);
      const rawText = pdfData.text;
      
      if (!rawText || rawText.length < 100) {
        console.log('  PDF contained no readable text (might be scanned images).');
        continue;
      }
      
      // Extract with Gemini
      const fixtureData = await extractDMXProfile(rawText, productName);
      
      if (fixtureData) {
        const fileName = fixtureData.id.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.ts';
        const filePath = path.join(RIGS_DIR, fileName);
        
        const fileContent = `import type { Rig } from '../../shared/types';\n\nexport const rig: Rig = ${JSON.stringify(fixtureData, null, 2)};\n`;
        
        fs.writeFileSync(filePath, fileContent);
        console.log(`  ✅ Successfully saved rig profile to src/rigs/${fileName}`);
      }

      // To avoid hitting the Gemini Free Tier Rate Limits (Tokens Per Minute), wait 15 seconds before the next manual
      console.log('  Sleeping 15 seconds to respect API rate limits...');
      await sleep(15000);

    } catch (err) {
      console.error(`  ❌ Error processing ${link}:`, err);
    }
  }

  await browser.close();
  console.log('\nScraping run complete.');
}

run().catch(console.error);
