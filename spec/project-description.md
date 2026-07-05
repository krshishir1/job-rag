## Always use yarn for installation

I am creating an application where people can search for a job based on the query they provide:

Queries could be: 
"Frontend engineers in Bengaluru"
"Find me the best UI/UX engineers in India asking for experience of 1 year"

I will be scraping the ziprecruiter.in website to get job title and description. There will be several jobs that will be scraped as well.

For web scraping, use axios + cheerio to parse the pages:

1) We'll first get all the job listings and get all the links

Job Listing Link example: https://www.ziprecruiter.in/jobs/search?jt=Full+Time&page=2&q=software+engineer

Go from page 1 to 5. Get all the individual links.

2) Then we'll fetch individual pages and get the additional details.

These will be the details we'll get:

- date_added: Timestamp 
- link: string(url)
- title: string
- company: string
- location: string
- description: string (markdown)


After web scraping we will store all these in the jobs table in postgres.
The columns will be:
- date_added: Timestamp 
- link: string(url)
- title: string
- company: string
- location: string
- description: string (markdown)

Then for chunking and embeddings, we'll need convert the JSON schema to be in form of a searchable document:

`
Date Added: 
Title:
Company:
Location:
Description:
`

After creating separate documents, it will be converted to embeddings.
For now, we will be chunking the entire documents completely at a time and store the embeddings in the job_embeddings table.

create table job_embeddings (
  id bigint generated always as identity primary key,
  job_id: (linked to the attached job),
  embedding vector(1536), -- match your embedding model's dimensions
);

Use pgvector in supabase for storing the embeddings.
For generating embeddings, we'll use the `Amazon Titan Text Embeddings V2` model in the AWS bedrock. Use the `BEDROCK_API_KEY` from the environment variable.

For database, use Supabase, create configs separately.
Environment variables present in the .env.
Install the @supabase/server.

Two tables for now:
- jobs: store all jobs
- job_embeddings: store job_id and embeddings
