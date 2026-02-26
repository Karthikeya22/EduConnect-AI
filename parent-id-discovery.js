import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findParentId() {
    const { error } = await supabase.from('student_assignment_logs').select('parent_id').limit(1);
    fs.writeFileSync('parent-id-discovery.json', JSON.stringify({ exists: !error }, null, 2));
}

findParentId();
