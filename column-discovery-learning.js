import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectLearningActivities() {
    const possibleCols = ['id', 'student_id', 'target_id', 'activity_type', 'topic', 'timestamp', 'created_at'];
    const foundColumns = [];
    const errors = [];

    for (const col of possibleCols) {
        const { error } = await supabase.from('student_learning_activities').select(col).limit(1);
        if (!error) {
            foundColumns.push(col);
        } else {
            errors.push({ col, error });
        }
    }

    fs.writeFileSync('column-discovery-learning.json', JSON.stringify({ foundColumns, errors }, null, 2));
}

inspectLearningActivities();
