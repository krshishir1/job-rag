import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment variables.');
}

/**
 * Supabase client configured with the service role key.
 * This bypasses Row Level Security (RLS) — suitable for backend/admin operations.
 */
export const supabase = createClient(supabaseUrl, supabaseKey);
