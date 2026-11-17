import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  (process.env.SUPABASE_URL ?? (() => { throw new Error('Set SUPABASE_URL'); })()),
  (process.env.SUPABASE_ANON_KEY ?? (() => { throw new Error('Set SUPABASE_ANON_KEY'); })())
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
