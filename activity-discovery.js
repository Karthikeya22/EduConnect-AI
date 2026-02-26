import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findActivityTable() {
    const trials = ['activity_logs', 'logs', 'audit_logs', 'user_activities', 'activity', 'system_logs', 'platform_logs'];
    const results = {};

    for (const table of trials) {
        const { error } = await supabase.from(table).select('*').limit(1);
        results[table] = { exists: !error || error.code !== 'PGRST205', error };
    }

    fs.writeFileSync('activity-discovery.json', JSON.stringify(results, null, 2));
}

findActivityTable();
