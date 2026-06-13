import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  'https://pxvwdjrraronjlumwljv.supabase.co',
  'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o'
);

async function run() {
  const data = {};
  
  // 1. Get an assignment
  const { data: assignments } = await supabase.from('assignments').select('*').limit(1);
  if (!assignments || assignments.length === 0) {
    console.log("No assignments found in Supabase.");
    return;
  }
  data.assignment = assignments[0];

  // 2. Get rubric
  const { data: rubrics } = await supabase.from('rubric_criteria').select('*').eq('assignment_id', data.assignment.id);
  data.rubrics = rubrics;

  // 3. Get submission
  const { data: submissions } = await supabase.from('submissions').select('*').eq('assignment_id', data.assignment.id).limit(1);
  
  if (!submissions || submissions.length === 0) {
     const { data: anySubmissions } = await supabase.from('submissions').select('*').limit(1);
     data.submission = anySubmissions[0];
  } else {
     data.submission = submissions[0];
  }

  // 4. Get course material
  const { data: materials } = await supabase.from('instructional_materials').select('*').eq('course_id', data.assignment.course_id);
  data.materials = materials;

  fs.writeFileSync('assignment_data.json', JSON.stringify(data, null, 2));
  console.log("Data dumped to assignment_data.json");
}

run();
