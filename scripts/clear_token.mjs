import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL ?? (() => { throw new Error('Set SUPABASE_URL'); })());
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY ?? (() => { throw new Error('Set SUPABASE_ANON_KEY'); })());
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
