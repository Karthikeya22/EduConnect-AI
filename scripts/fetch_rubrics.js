import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://pxvwdjrraronjlumwljv.supabase.co',
  'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o'
);

async function run() {
  const { data: rubrics } = await supabase.from('rubric_criteria').select('*');
  console.log("Rubrics:");
  console.log(JSON.stringify(rubrics, null, 2));

  const { data: assignments } = await supabase.from('assignments').select('*');
  console.log("Assignments:");
  console.log(JSON.stringify(assignments, null, 2));
}

run();
