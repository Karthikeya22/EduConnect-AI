import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    // We can't query information_schema directly with the anon key usually.
    // But we can try to guess or use RPC if exists.
    // Instead, let's try to select from likely tables and see what fails.

    const tables = ['students', 'assignments', 'student_assignment_logs', 'student_learning_activities', 'platform_activity_logs', 'instructional_materials', 'teacher_preferences'];
    const results = {};

    for (const table of tables) {
        const { data, error } = await supabase.from(table).select('*').limit(1);
        results[table] = { exists: !error || (error.code !== 'PGRST116' && error.code !== 'PGRST204' && error.code !== 'PGRST205'), error };
        if (data && data.length > 0) {
            results[table].columns = Object.keys(data[0]);
        }
    }

    fs.writeFileSync('schema-inspection.json', JSON.stringify(results, null, 2));
}

inspectSchema();
