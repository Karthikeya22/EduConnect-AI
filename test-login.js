import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLogin() {
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'john3@mail.usf.edu',
        password: 'password123'
    });

    fs.writeFileSync('output5.json', JSON.stringify({ error, user_exists: !!data?.user }, null, 2));
}

checkLogin();
