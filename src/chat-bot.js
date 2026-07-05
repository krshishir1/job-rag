import dotenv from 'dotenv';
dotenv.config();

// Map BEDROCK_API_KEY to the environment variable recognized by AWS SDK for Bedrock API keys
// if (process.env.BEDROCK_API_KEY) {
//     process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;
// }

import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getEmbedding } from './embedder.js';
import { supabase } from './supabase.js';

const e = React.createElement;

// Initialize the Bedrock client
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

/**
 * Computes cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let mA = 0;
    let mB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        mA += a[i] * a[i];
        mB += b[i] * b[i];
    }
    if (mA === 0 || mB === 0) return 0;
    return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}

/**
 * Performs semantic search (queries pgvector via RPC, or falls back to client-side vector search)
 */
async function performSemanticSearch(query, limit = 3) {
    try {
        const queryEmbedding = await getEmbedding(query);

        // 1. Try querying the RPC function 'match_jobs'
        const { data: rpcData, error: rpcError } = await supabase.rpc('match_jobs', {
            query_embedding: queryEmbedding,
            match_threshold: 0.3,
            match_count: limit
        });

        if (!rpcError && rpcData && rpcData.length > 0) {
            return rpcData;
        }

        // 2. Fallback: Client-side vector similarity search (independent of custom postgres functions)
        const { data: jobs, error: jobsError } = await supabase
            .from('jobs')
            .select('*');

        if (jobsError) throw jobsError;
        if (!jobs || jobs.length === 0) return [];

        const { data: embeddings, error: embError } = await supabase
            .from('job_embeddings')
            .select('job_id, embedding');

        if (embError) throw embError;
        if (!embeddings || embeddings.length === 0) return [];

        const embMap = new Map();
        embeddings.forEach(e => {
            try {
                const parsed = typeof e.embedding === 'string' ? JSON.parse(e.embedding) : e.embedding;
                if (Array.isArray(parsed)) {
                    embMap.set(e.job_id, parsed);
                }
            } catch (err) {
                // Ignore parsing errors
            }
        });

        const scoredJobs = jobs
            .map(job => {
                const emb = embMap.get(job.id);
                const similarity = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
                return { ...job, similarity };
            })
            .filter(job => job.similarity > 0.3)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);

        return scoredJobs;
    } catch (error) {
        console.error('\n[Error in semantic search]:', error.message);
        return [];
    }
}

/**
 * Queries AWS Bedrock to generate a friendly summary response
 */
async function generateChatResponse(query, matchingJobs) {
    if (!matchingJobs || matchingJobs.length === 0) {
        return "I couldn't find any matching jobs in the database. Feel free to search with other keywords or locations!";
    }

    const jobsText = matchingJobs.map((job, idx) => {
        return `[Job #${idx + 1}]
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Unknown'}
Description: ${job.description}
Link: ${job.link}`;
    }).join('\n\n');

    const prompt = `System: You are a friendly and professional job recruiting chatbot assistant.
Analyze the following user query and matching jobs from our database. Generate a natural, helpful response summarizing the jobs that best match the query. Highlight the key details (title, company, location) and explain briefly why they fit. Provide the job links as references. Keep the response concise, clear, and readable.

User Query: "${query}"

Matching Jobs:
${jobsText}

Assistant:`;

    const payload = {
        inputText: prompt,
        textGenerationConfig: {
            maxTokenCount: 1000,
            temperature: 0.7,
            topP: 0.9
        }
    };

    try {
        const command = new InvokeModelCommand({
            modelId: 'amazon.titan-text-express-v1',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(payload)
        });

        const response = await bedrockClient.send(command);
        const decoded = JSON.parse(new TextDecoder().decode(response.body));
        return decoded.results[0].outputText.trim();
    } catch (error) {
        // Fallback: Custom text generation formatting if the LLM invocation fails
        let fallback = `Here are the top matches I found in our database for "${query}":\n\n`;
        matchingJobs.forEach((job, idx) => {
            fallback += `${idx + 1}. **${job.title}** at **${job.company}** (${job.location || 'Remote'})\n   Link: ${job.link}\n\n`;
        });
        return fallback.trim();
    }
}

/**
 * Ink Chatbot Application Component
 */
function ChatbotApp() {
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState([
        { sender: 'bot', text: 'Hello! I am your Job Search Assistant. Ask me anything, e.g. "Find me Software Engineer roles" or "Any developer jobs at Redwood?"' }
    ]);

    const { exit } = useApp();

    // Bind Ctrl+C to clean exit
    useInput((inputStr, key) => {
        if (key.ctrl && inputStr === 'c') {
            exit();
        }
    });

    const handleSubmit = async () => {
        const userQuery = input.trim();
        if (!userQuery) return;

        if (userQuery.toLowerCase() === 'exit' || userQuery.toLowerCase() === 'quit') {
            exit();
            return;
        }

        setMessages(prev => [...prev, { sender: 'user', text: userQuery }]);
        setInput('');
        setLoading(true);

        try {
            const matches = await performSemanticSearch(userQuery);
            const botResponse = await generateChatResponse(userQuery, matches);
            setMessages(prev => [...prev, { sender: 'bot', text: botResponse }]);
        } catch (err) {
            setMessages(prev => [...prev, { sender: 'bot', text: `An error occurred: ${err.message}` }]);
        } finally {
            setLoading(false);
        }
    };

    // Render message elements
    const messageElements = messages.map((msg, idx) => {
        return e(Box, { key: idx, marginBottom: 1, flexDirection: 'column' },
            e(Text, { bold: true, color: msg.sender === 'user' ? 'green' : 'cyan' },
                msg.sender === 'user' ? '👤 You:' : '🤖 Bot:'
            ),
            e(Box, { paddingLeft: 2 },
                e(Text, null, msg.text)
            )
        );
    });

    if (loading) {
        messageElements.push(
            e(Box, { key: 'loading', marginBottom: 1 },
                e(Text, { italic: true, color: 'yellow' }, '⏳ Searching Supabase and generating Bedrock response...')
            )
        );
    }

    return e(Box, { flexDirection: 'column', padding: 1, borderStyle: 'round', borderColor: 'cyan' },
        // Header Banner
        e(Box, { marginBottom: 1, justifyContent: 'center' },
            e(Text, { color: 'cyan', bold: true }, '🤖 JOB RAG SEMANTIC CHATBOT 🤖')
        ),
        e(Box, { marginBottom: 1, justifyContent: 'center' },
            e(Text, { dimColor: true }, '(Type "exit" or "quit" to leave the chat)')
        ),
        // Messages Area
        e(Box, { flexDirection: 'column', minHeight: 10, maxHeight: 25, overflowY: 'hidden' },
            messageElements
        ),
        // Input Area
        e(Box, { borderStyle: 'single', borderColor: 'gray', paddingLeft: 1, paddingRight: 1, marginTop: 1 },
            e(Text, { bold: true, color: 'green' }, '> '),
            e(TextInput, {
                value: input,
                onChange: setInput,
                onSubmit: handleSubmit,
                placeholder: 'Ask about a job or keyword...'
            })
        )
    );
}

// Launch the Ink render tree
render(e(ChatbotApp));
