import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findColumns() {
    const { data, error } = await supabase
        .from('student_assignment_logs')
        .select('*')
        .limit(1);

    // If no data, we can try to find columns by trying to select them specifically
    // Or we can try to guess common names and see which ones don't error
    const possiblePageColumns = ['id', 'student_id', 'assignment_id', 'interaction_type', 'content', 'metadata', 'timestamp', 'created_at', 'updated_at', 'score', 'grade', 'feedback'];
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

    fs.writeFileSync('column-discovery.json', JSON.stringify({ foundColumns, errors }, null, 2));
}

findColumns();
