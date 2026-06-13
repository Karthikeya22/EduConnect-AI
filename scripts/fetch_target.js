import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  'https://pxvwdjrraronjlumwljv.supabase.co',
  'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o'
);

async function run() {
  const { data: assignments } = await supabase.from('assignments').select('*');
  const { data: rubrics } = await supabase.from('rubric_criteria').select('*');
  
  // Just take the first assignment that has a rubric
  let chosenAssignment = null;
  for (const a of assignments) {
      const a_rubrics = rubrics.filter(r => r.assignment_id === a.id);
      if (a_rubrics.length > 0) {
          chosenAssignment = a;
          break;
      }
  }

  if (!chosenAssignment) {
      console.log("No assignments with rubrics found.");
      return;
  }
  
  const { data: submissions } = await supabase.from('submissions').select('*').eq('assignment_id', chosenAssignment.id);

  console.log("Chosen Assignment ID:", chosenAssignment.id);
  console.log("Title:", chosenAssignment.title);
  
  fs.writeFileSync('target_assignment.json', JSON.stringify({
      assignment: chosenAssignment,
      rubrics: rubrics.filter(r => r.assignment_id === chosenAssignment.id),
      submissions: submissions
  }, null, 2));
}

run();
