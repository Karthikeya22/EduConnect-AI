import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findLearningTarget() {
    const possibleCols = ['material_id', 'assignment_id', 'link_id', 'object_id', 'resource_id', 'reference_id'];
    const foundColumns = [];

    for (const col of possibleCols) {
        const { error } = await supabase.from('student_learning_activities').select(col).limit(1);
        if (!error) foundColumns.push(col);
    }

    fs.writeFileSync('learning-target-discovery.json', JSON.stringify({ foundColumns }, null, 2));
}

findLearningTarget();
