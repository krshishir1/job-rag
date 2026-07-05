import dotenv from 'dotenv';
dotenv.config();

// Map BEDROCK_API_KEY to the environment variable recognized by AWS SDK for Bedrock API keys
// if (process.env.BEDROCK_API_KEY) {
//     process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;
// }

import { fileURLToPath } from 'url';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { scrapeJobs } from './scraper.js';
import { supabase } from './supabase.js';

const __filename = fileURLToPath(import.meta.url);

// Initialize the Bedrock Runtime Client
const client = new BedrockRuntimeClient({ region: 'us-east-1' });

/**
 * Generates the Amazon Titan V2 embedding for a given text
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function getEmbedding(text) {
    const payload = {
        inputText: text,
        dimensions: 1024, // Titan V2 max is 1024 (supported: 256, 512, 1024)
        normalize: true   // Normalizes output vectors; ideal for RAG/cosine similarity
    };

    const input = {
        modelId: 'amazon.titan-embed-text-v2:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
    };

    const command = new InvokeModelCommand(input);
    const response = await client.send(command);

    // Decode the response body (returned as a Uint8Array)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Extract the embedding vector
    return responseBody.embedding;
}

/**
 * Formats a job object into the searchable document text structure specified in project-description.md
 * @param {object} job
 * @returns {string}
 */
export function formatJobDocument(job) {
    return `Date Added: ${new Date(job.date_added).toISOString()}
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Unknown'}
Description: ${job.description}`;
}

/**
 * Runs the full scraping, embedding, and Supabase storage pipeline with de-duplication
 * @param {string} query
 * @param {number} limit
 */
export async function runEmbedderPipeline(query = 'software engineer', limit = 10) {
    console.log(`--- Starting Pipeline (Scraper + Embedder + Supabase) ---`);

    // 1. Scrape the jobs (will fall back to mock HTML if live fetch is blocked)
    const scrapedJobs = await scrapeJobs(query, 1, 1, limit);

    if (!scrapedJobs || scrapedJobs.length === 0) {
        console.error('No jobs were retrieved by the scraper. Pipeline aborted.');
        return;
    }

    const jobsToProcess = scrapedJobs;

    // 2. Fetch already existing jobs by link to prevent duplicates
    const links = jobsToProcess.map(job => job.link);
    const { data: existingJobs, error: selectError } = await supabase
        .from('jobs')
        .select('id, link')
        .in('link', links);

    if (selectError) {
        console.error('Failed to check existing jobs in Supabase:', selectError.message);
        return;
    }

    const existingLinks = new Set(existingJobs?.map(job => job.link) || []);

    // Filter down to only new jobs
    const newJobs = jobsToProcess.filter(job => !existingLinks.has(job.link));

    console.log(`\nFound ${jobsToProcess.length} scraped jobs.`);
    console.log(`${existingLinks.size} jobs already exist in the database.`);
    console.log(`${newJobs.length} new jobs to insert and embed.`);

    if (newJobs.length === 0) {
        console.log('\n--- No new jobs to process. Pipeline Completed ---');
        return;
    }

    // 3. Batch insert new jobs into the `jobs` table
    console.log(`\n--- Inserting ${newJobs.length} new jobs into Supabase ---`);
    const jobRows = newJobs.map((job) => ({
        date_added: new Date(job.date_added).toISOString(),
        link: job.link,
        title: job.title,
        company: job.company,
        location: job.location || 'Unknown',
        description: job.description,
    }));

    const { data: insertedJobs, error: insertError } = await supabase
        .from('jobs')
        .insert(jobRows)
        .select('id');

    if (insertError) {
        console.error('Failed to insert jobs into Supabase:', insertError.message);
        return;
    }

    console.log(`Successfully inserted ${insertedJobs.length} jobs into the jobs table.`);

    // 4. Generate embeddings in PARALLEL for the new jobs
    console.log(`\n--- Generating embeddings in parallel for ${newJobs.length} jobs ---`);

    const embeddingPromises = newJobs.map(async (job, index) => {
        const jobId = insertedJobs[index].id;
        const docText = formatJobDocument(job);
        console.log(`[${index + 1}/${newJobs.length}] Generating embedding for: "${job.title}"`);

        const embedding = await getEmbedding(docText);
        return { jobId, embedding };
    });

    const embeddingResults = await Promise.allSettled(embeddingPromises);

    // Collect successful embeddings
    const embeddingRows = [];
    let failCount = 0;

    for (let i = 0; i < embeddingResults.length; i++) {
        const result = embeddingResults[i];
        if (result.status === 'fulfilled') {
            embeddingRows.push({
                job_id: result.value.jobId,
                embedding: JSON.stringify(result.value.embedding),
            });
        } else {
            failCount++;
            console.error(`  Failed embedding for "${newJobs[i].title}":`, result.reason?.message || result.reason);
        }
    }

    console.log(`\nEmbedding generation complete: ${embeddingRows.length} succeeded, ${failCount} failed.`);

    // 5. Batch insert embeddings into the `job_embeddings` table
    if (embeddingRows.length > 0) {
        console.log(`\n--- Inserting ${embeddingRows.length} embeddings into Supabase ---`);

        const { error: embeddingInsertError } = await supabase
            .from('job_embeddings')
            .insert(embeddingRows);

        if (embeddingInsertError) {
            console.error('Failed to insert embeddings into Supabase:', embeddingInsertError.message);
            return;
        }

        console.log(`Successfully inserted ${embeddingRows.length} embeddings into the job_embeddings table.`);
    }

    console.log(`\n--- Pipeline Completed ---`);
}

// Direct file execution wrapper
const isDirectRun = process.argv[1] && (
    process.argv[1] === __filename ||
    process.argv[1].endsWith('embedder.js')
);

if (isDirectRun) {
    const queryArg = process.argv[2] || 'software engineer';
    const limitArg = parseInt(process.argv[3] || '50', 10);

    runEmbedderPipeline(queryArg, limitArg).catch((err) => {
        console.error('Pipeline execution failed:', err);
        process.exit(1);
    });
}
