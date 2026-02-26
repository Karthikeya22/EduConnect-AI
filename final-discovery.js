import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findFinalColumns() {
    const { data, error } = await supabase.from('student_assignment_logs').select('*').limit(1);
    // If table is empty, we still have problem.
    // Let's try to insert a row with JUST required fields and see what's returned if we can.

    // Actually, I'll try to find any column that exists by trying to select it.
    // I'll try more variations.
    const possibleCols = ['student_email', 'assignment_name', 'status', 'is_submitted', 'meta', 'payload', 'json_data', 'extra', 'props', 'context', 'rubric_eval', 'ai_feedback', 'ai_grade'];
    const foundColumns = [];

    for (const col of possibleCols) {
        const { error } = await supabase.from('student_assignment_logs').select(col).limit(1);
        if (!error) foundColumns.push(col);
    }

    fs.writeFileSync('final-discovery.json', JSON.stringify({ foundColumns }, null, 2));
}

findFinalColumns();
