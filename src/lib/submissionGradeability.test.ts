import {
  emptySubmissionHeadline,
  hasGradeableSubmission,
  isPlaceholderSubmissionBody,
  isUngradedSubmitted,
  submissionListLabel,
} from './submissionGradeability';

if (!isPlaceholderSubmissionBody('')) throw new Error('empty is placeholder');
if (!isPlaceholderSubmissionBody('No submission content.')) throw new Error('no content');
if (!isPlaceholderSubmissionBody('Submission type: online_upload')) throw new Error('type line');
if (isPlaceholderSubmissionBody('Hello essay')) throw new Error('essay is not placeholder');

const withFile = {
  body: 'No submission content.',
  attachments: [{ url: 'https://x/file.docx', display_name: 'a.docx' }],
};
if (!hasGradeableSubmission(withFile)) throw new Error('attachment should be gradeable');
if (submissionListLabel(withFile) !== 'Uploaded file') throw new Error('label uploaded');

const missing = { body: 'No submission content.', status: 'Missing' };
if (hasGradeableSubmission(missing)) throw new Error('missing not gradeable');
if (isUngradedSubmitted(missing)) throw new Error('missing not ungraded');
if (emptySubmissionHeadline(missing) !== 'No Canvas submission') throw new Error('headline');
if (submissionListLabel(missing) !== 'No Canvas submission') throw new Error('list label');

if (!isUngradedSubmitted({ status: 'Ungraded', body: 'text', score: null })) {
  throw new Error('ungraded submitted');
}
if (isUngradedSubmitted({ status: 'Graded', body: 'text', score: 10 })) {
  throw new Error('graded should not count');
}

console.log('submissionGradeability.test.ts PASS');
