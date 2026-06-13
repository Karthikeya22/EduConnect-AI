import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pxvwdjrraronjlumwljv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSchema() {
  const { data, error } = await supabase
    .from('teacher_preferences')
    .select('gemini_api_key')
    .limit(1);
    
  console.log("Data:", data);
  console.log("Error:", error);
}

checkSchema();
