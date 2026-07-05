import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gotScraping } from 'got-scraping';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parses natural language search queries to extract keywords (q) and location (l)
 * @param {string} query 
 * @returns {{ q: string, l: string }}
 */
export function parseSearchQuery(query) {
  if (!query) return { q: '', l: '' };

  let q = query.trim();
  let l = '';

  // Match "in <location>" or "at <location>" stopping at common trailing structures (like asking, with, etc.)
  const locationMatch = q.match(/\b(in|at)\b\s+([^,.-]+?)(?=\s+\b(asking|with|having|requiring|of|for|experience)\b|$)/i);
  if (locationMatch) {
    l = locationMatch[2].trim();
    q = q.replace(locationMatch[0], '').trim();
  }

  // Remove filler words
  const fillerRegex = /^(find\s+me\s+the\s+best|find\s+me|search\s+for|looking\s+for|show\s+me|jobs\s+for)\s+/i;
  q = q.replace(fillerRegex, '');

  // Strip wrapping quotes and extra whitespace
  q = q.replace(/^["'\s]+|["'\s]+$/g, '').trim();

  return { q, l };
}

/**
 * Converts a Cheerio element or HTML string to clean Markdown
 * @param {string} html 
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  if (!html) return '';
  
  const $ = cheerio.load(html, null, false);
  
  function processNode(node) {
    let result = '';
    
    $(node).contents().each((_, child) => {
      if (child.type === 'text') {
        result += child.data;
      } else if (child.type === 'tag') {
        const tagName = child.name.toLowerCase();
        const innerContent = processNode(child);
        
        switch (tagName) {
          case 'strong':
          case 'b':
            result += ` **${innerContent.trim()}** `;
            break;
          case 'em':
          case 'i':
            result += ` *${innerContent.trim()}* `;
            break;
          case 'p':
            result += `\n\n${innerContent.trim()}\n\n`;
            break;
          case 'br':
            result += '\n';
            break;
          case 'ul':
          case 'ol':
            result += `\n${innerContent}\n`;
            break;
          case 'li':
            result += `- ${innerContent.trim()}\n`;
            break;
          case 'h1':
            result += `\n# ${innerContent.trim()}\n\n`;
            break;
          case 'h2':
            result += `\n## ${innerContent.trim()}\n\n`;
            break;
          case 'h3':
            result += `\n### ${innerContent.trim()}\n\n`;
            break;
          case 'div':
          case 'span':
          default:
            result += innerContent;
            break;
        }
      }
    });
    
    return result;
  }
  
  let markdown = processNode($.root());
  
  // Clean up excessive whitespace/newlines
  markdown = markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')               // reduce multiple spaces/tabs
    .replace(/\n{3,}/g, '\n\n')            // reduce 3+ newlines to 2
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
    
  return markdown;
}

/**
 * Extracts unique absolute job links from the listing page HTML
 * @param {string} html 
 * @returns {string[]}
 */
export function parseListingPage(html) {
  const $ = cheerio.load(html);
  const links = [];
  
  $('.job-listing .job-link').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      const absoluteUrl = href.startsWith('http') 
        ? href 
        : new URL(href, 'https://www.ziprecruiter.in').toString();
      if (!links.includes(absoluteUrl)) {
        links.push(absoluteUrl);
      }
    }
  });
  
  return links;
}

/**
 * Extracts job details from individual job page HTML
 * @param {string} html 
 * @param {string} link 
 * @returns {{ date_added: number, link: string, title: string, company: string, location: string, description: string }}
 */
export function parseJobPage(html, link) {
  const $ = cheerio.load(html);
  
  let title = '';
  let company = '';
  let dateAdded = null;
  let location = '';
  
  // Try application/ld+json parsing first
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html();
      if (text) {
        const data = JSON.parse(text);
        if (data && (data['@type'] === 'JobPosting' || data.type === 'JobPosting')) {
          title = title || data.title;
          company = company || data.hiringOrganization?.name;
          if (data.datePosted && !dateAdded) {
            const parsed = new Date(data.datePosted);
            if (!isNaN(parsed.getTime())) {
              dateAdded = parsed.getTime();
            }
          }
          if (data.jobLocation?.address && !location) {
            const addr = data.jobLocation.address;
            const region = addr.addressRegion || '';
            const locality = addr.addressLocality || '';
            const postalCode = addr.postalCode || '';
            const country = addr.addressCountry || '';
            location = [locality, region, postalCode, country]
              .filter(Boolean)
              .join(', ');
          }
        }
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  });
  
  // Fallbacks to DOM
  if (!title) {
    title = $('h1.u-mv--remove.u-textH2').text().trim() || $('h1').text().trim();
  }
  if (!company) {
    company = $('.text-primary.text-large strong').text().trim() || $('.jobDetail-headerIntro .text-primary').text().trim();
  }
  if (!location) {
    // Look for map marker text parent
    location = $('.fa-map-marker-alt').parent().text().trim();
  }
  if (!dateAdded) {
    const postedText = $('.text-muted').text().trim();
    const match = postedText.match(/Posted\s+([^,]+,\s*\d{4}|\d{1,2}\s+[A-Za-z]+)/i);
    if (match) {
      const parsed = new Date(match[1]);
      if (!isNaN(parsed.getTime())) {
        dateAdded = parsed.getTime();
      }
    }
  }
  
  // Final fallback for date
  if (!dateAdded) {
    dateAdded = Date.now();
  }
  
  const descriptionHtml = $('.job-body').html() || '';
  const descriptionMarkdown = htmlToMarkdown(descriptionHtml);
  
  return {
    date_added: dateAdded,
    link: link,
    title: title || 'Unknown Title',
    company: company || 'Unknown Company',
    location: location || 'Unknown Location',
    description: descriptionMarkdown
  };
}

async function fetchPage(url) {
  const response = await gotScraping.get(url);
  return response.body;
}

/**
 * Main scraper function
 * @param {string} query 
 * @param {number} startPage 
 * @param {number} endPage 
 * @param {number} limit - Maximum number of jobs to scrape
 */
export async function scrapeJobs(query, startPage = 1, endPage = 5, limit = Infinity) {
  const { q, l } = parseSearchQuery(query);
  console.log(`Starting scraper for query: "${query}" -> Parsed Search term: "${q}", Location: "${l}"`);
  
  let jobLinks = [];
  
  // 1. Get Listing pages and collect links
  for (let page = startPage; page <= endPage; page++) {
    const url = `https://www.ziprecruiter.in/jobs/search?jt=Full+Time&page=${page}&q=${encodeURIComponent(q)}&l=${encodeURIComponent(l)}`;
    console.log(`Fetching listing page ${page}: ${url}`);
    
    const html = await fetchPage(url);
    const links = parseListingPage(html);
    console.log(`Found ${links.length} links on page ${page}`);
    
    for (const link of links) {
      if (!jobLinks.includes(link)) {
        jobLinks.push(link);
      }
      if (jobLinks.length >= limit) {
        break;
      }
    }
    
    if (jobLinks.length >= limit) {
      break;
    }
    
    // Rate limiting: 200ms delay between page requests
    await sleep(200);
  }
  
  const linksToScrape = jobLinks.slice(0, limit);
  let scrapedJobs = [];
  
  // 2. Fetch and parse each job page
  console.log(`\nStarting details fetching for ${linksToScrape.length} job links...`);
  for (let i = 0; i < linksToScrape.length; i++) {
    const link = linksToScrape[i];
    console.log(`[${i + 1}/${linksToScrape.length}] Fetching: ${link}`);
    
    try {
      const html = await fetchPage(link);
      const jobDetails = parseJobPage(html, link);
      scrapedJobs.push(jobDetails);
      console.log(`Scraped job: "${jobDetails.title}" at "${jobDetails.company}"`);
    } catch (error) {
      console.error(`Failed to scrape job page details for ${link}: ${error.message}`);
    }
    
    // Rate limiting: 200ms delay between page requests
    await sleep(200);
  }
  
  console.log(`\nScraping complete. Retrieved ${scrapedJobs.length} jobs.`);
  return scrapedJobs;
}

// Direct file execution wrapper
const isDirectRun = process.argv[1] && (
  process.argv[1] === __filename || 
  process.argv[1].endsWith('scraper.js')
);

if (isDirectRun) {
  const queryArg = process.argv[2] || 'software engineer';
  const startPage = parseInt(process.argv[3] || '1', 10);
  const endPage = parseInt(process.argv[4] || '5', 10);
  
  scrapeJobs(queryArg, startPage, endPage).catch((err) => {
    console.error('Scraper execution failed:', err);
    process.exit(1);
  });
}
