
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkModules() {
    const { data, error } = await supabase.from('course_modules').select('*').limit(1);
    fs.writeFileSync('module_check.json', JSON.stringify({ data, error }, null, 2));
}

checkModules();
