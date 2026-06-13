import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseAnonKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log("Deleting expired token from teacher_preferences database...");
  const { data, error } = await supabase
    .from('teacher_preferences')
    .delete()
    .eq('teacher_email', 'dr.smith@educonnect.ai');
    
  if (error) {
    console.error("Failed to delete token from database:", error);
  } else {
    console.log("Successfully deleted token from database! Response data:", data);
  }
}

run();
