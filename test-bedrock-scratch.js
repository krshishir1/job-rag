import dotenv from 'dotenv';
dotenv.config();

// Map BEDROCK_API_KEY to the environment variable recognized by AWS SDK for Bedrock API keys
if (process.env.BEDROCK_API_KEY) {
  process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;
}

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Initialize the Bedrock Runtime Client
const client = new BedrockRuntimeClient({ region: "us-east-1" });

async function getTitanEmbeddings() {
  const textToEmbed = "Hello world, this is a test string for Amazon Titan Text Embeddings.";
  
  // Prepare the native payload required by the Titan V2 model
  const payload = {
    inputText: textToEmbed,
    dimensions: 1536,  // Titan V2 supports 256, 512, 1024, or 1536 dimensions
    normalize: true    // Normalizes output vectors; ideal for RAG/cosine similarity
  };

  // Build the command parameters
  const input = {
    modelId: "amazon.titan-embed-text-v2:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(payload),
  };

  try {
    // Instantiate and send the command
    const command = new InvokeModelCommand(input);
    const response = await client.send(command);

    // Decode the response body (returned as a Uint8Array)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Extract the embedding vector
    const embedding = responseBody.embedding;

    console.log("Successfully generated embeddings!");
    console.log(`Vector Dimension Size: ${embedding.length}`);
    console.log("Sample Vector Preview (First 5 dimensions):", embedding.slice(0, 5));
    
    return embedding;
  } catch (error) {
    console.error("Error invoking Amazon Titan Embeddings:", error);
  }
}

getTitanEmbeddings();
