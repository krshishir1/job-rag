# Terminal Chatbot Frontend

We have implemented an interactive command-line interface chatbot in [src/chat-bot.js](file:///Users/shishir/Desktop/ai-projects/slack%20agents/job-rag/src/chat-bot.js) using the `Ink` library.

## Features
1. **Interactive UI**: Powered by React Ink, providing a stylized terminal box, borders, input cursor, and state indicators.
2. **Semantic Vector Search**:
   - Takes your search query and computes its vector representation.
   - Queries Supabase using cosine similarity against the `job_embeddings` table.
   - Designed to call the remote `match_jobs` RPC function first, falling back to a client-side similarity comparison if the database function hasn't been created yet.
3. **Bedrock Natural Language Generation**:
   - Sends the matched jobs as context to the `amazon.titan-text-express-v1` model in AWS Bedrock.
   - Generates a friendly, summarized recruiting response answering the query.
   - If the model is not enabled or returns an error, it gracefully falls back to a clean, formatted Markdown listing.

## How to Run
Run the following command to start the chatbot:
```bash
yarn chat
```
Or:
```bash
node src/chat-bot.js
```
*(To exit, type `exit` or `quit`, or press `Ctrl+C`).*
