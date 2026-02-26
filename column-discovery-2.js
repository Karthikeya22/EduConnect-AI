import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findMoreColumns() {
    const possiblePageColumns = ['course_id', 'submission_content', 'data', 'details', 'body'];
    const foundColumns = [];
    const errors = [];

    for (const col of possiblePageColumns) {
        const { error } = await supabase.from('student_assignment_logs').select(col).limit(1);
        if (!error) {
            foundColumns.push(col);
        } else {
            errors.push({ col, error });
        }
    }

    fs.writeFileSync('column-discovery-2.json', JSON.stringify({ foundColumns, errors }, null, 2));
}

findMoreColumns();
