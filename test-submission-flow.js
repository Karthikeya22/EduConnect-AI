import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://pxvwdjrraronjlumwljv.supabase.co';
const supabaseKey = 'sb_publishable_nPwHDZEKALJdyqg7XaCSFQ_lrcsv-3o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSubmissionFlow() {
    const email = `test.sub.${Date.now()}@usf.edu`;
    const { data: authData, error: authErr } = await supabase.auth.signUp({
        email,
        password: 'password123',
        options: {
            data: {
                full_name: 'Sub Tester',
                role: 'student'
            }
        }
    });

    if (authErr) {
        fs.writeFileSync('output-sub-test.json', JSON.stringify({ authErr }, null, 2));
        return;
    }

    const userId = authData.user.id;
    const results = {
        userId,
        studentInsertErr: null,
        assignmentLogInsertErr: null,
        activityLogInsertErr: null,
        teacherReadLogsErr: null,
        teacherReadLogsData: null
    };

    // 1. Insert into students (should work if RLS was fixed or disabled)
    const { error: sErr } = await supabase.from('students').insert({
        id: userId,
        student_name: 'Sub Tester',
        student_email: email,
        enrolled_courses: ['BIG_DATA_2026']
    });
    results.studentInsertErr = sErr;

    // 2. Try to insert into student_assignment_logs
    // In AssignmentWork.tsx:
    // await supabase.from('student_assignment_logs').insert({
    //   student_id: session.user.id,
    //   assignment_id: props.assignmentId,
    //   interaction_type: 'submission',
    //   content: submission,
    //   timestamp: new Date().toISOString()
    // });
    const { error: alErr } = await supabase.from('student_assignment_logs').insert({
        student_id: userId,
        assignment_id: '1e3a968a-6677-4402-990a-a537f7690f77', // Existing assignment ID from previous logs if possible, or just a valid UUID format
        interaction_type: 'submission',
        content: 'Test content from script',
        timestamp: new Date().toISOString()
    });
    results.assignmentLogInsertErr = alErr;

    // 3. Try to insert into platform_activity_logs (used by logActivity)
    const { error: plErr } = await supabase.from('platform_activity_logs').insert({
        user_id: userId,
        user_email: email,
        action: 'LOGIN_EVENT',
        details: 'Student accessed dashboard',
        metadata: { role: 'student' },
        created_at: new Date().toISOString()
    });
    results.activityLogInsertErr = plErr;

    // 4. Try to read as the same user (simulating teacher might fail if RLS is strict and they are not teacher role)
    // Actually, I'll just check if the logs can be read at all by the anon key (which is what I have)
    const { data: logs, error: rlErr } = await supabase.from('student_assignment_logs').select('*');
    results.teacherReadLogsErr = rlErr;
    results.teacherReadLogsData = logs;

    fs.writeFileSync('output-sub-test.json', JSON.stringify(results, null, 2));
}

testSubmissionFlow();
