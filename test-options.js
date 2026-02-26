import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

// We can use native fetch to send an OPTIONS request
async function checkSchema() {
    const res = await fetch(`${supabaseUrl}/rest/v1/students`, {
        method: 'OPTIONS',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        }
    });

    const text = await res.text();
    fs.writeFileSync('output-options.json', text);
}

checkSchema();
