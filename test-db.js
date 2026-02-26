import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    const { data: students, error: err1 } = await supabase.from('students').select('*');
    const { data: assignments, error: err2 } = await supabase.from('student_assignment_logs').select('*');
    const { data: materials, error: err3 } = await supabase.from('instructional_materials').select('*').limit(10);

    fs.writeFileSync('output.json', JSON.stringify({ students, assignments, materials, err1, err2, err3 }, null, 2));
}

checkData();
