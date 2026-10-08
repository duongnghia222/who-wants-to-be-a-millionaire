const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { googleSearchUrl, validProgress, randomQuestionId } = require('../study-core.js');

const context = { window: {} };
runInNewContext(readFileSync(require.resolve('../data/questions.js'), 'utf8'), context);
const data = JSON.parse(JSON.stringify(context.window.STUDY_DATA));
const questions = data.questions;
const excludedIds = require('../data/excluded-easy-question-ids.json');
const bookQuestions = require('../data/book-questions.json');
const authoredQuestions = require('../data/learning-questions.json');
const bookExplanations = require('../data/book-explanations.json');
const editorialIds = require('../data/editorial-exclusions.json').groups.flatMap(group => group.ids);
// Core learning behavior has its own fixture so editorial changes do not redefine it.
const learningQuestions = [
  { id: 1, answer: 'D' }, { id: 2, answer: 'D' }, { id: 3, answer: 'B' },
  { id: 4, answer: 'C' }, { id: 5, answer: 'D' },
];

test('the bank combines retained book IDs with new questions without changing retained source rows', () => {
  assert.equal(questions.length, 419);
  assert.equal(data.total, questions.length);
  assert.equal(excludedIds.length, 606);
  const excluded = new Set(excludedIds);
  assert.equal(excluded.size, excludedIds.length);
  assert.ok(excludedIds.every(id => Number.isInteger(id) && id >= 1 && id <= 1044));
  assert.deepEqual(bookQuestions.map(question => question.id), Array.from({ length: 1044 }, (_, i) => i + 1).filter(id => !excluded.has(id)));
  const editorial = new Set(editorialIds);
  assert.equal(editorial.size, editorialIds.length);
  const retained = bookQuestions.filter(question => !editorial.has(question.id));
  assert.equal(data.bookTotal, retained.length);
  const supplements = new Map(bookExplanations.map(item => [item.id, item.explanation]));
  assert.deepEqual(questions.filter(question => question.kind !== 'learning'), retained.map(question => supplements.has(question.id) ? { ...question, explanation: supplements.get(question.id), explanationSource: 'authored' } : question));
  assert.deepEqual(questions.filter(question => question.kind === 'learning'), authoredQuestions);
  questions.forEach((question, index) => {
    assert.ok(index === 0 || question.id > questions[index - 1].id);
    assert.deepEqual(Object.keys(question.options), ['A', 'B', 'C', 'D']);
    assert.ok(question.options[question.answer]);
    assert.ok(question.question.length > 5);
    if (question.kind !== 'learning') {
      assert.ok(Number.isInteger(question.printedPage) && question.printedPage >= 7 && question.printedPage <= 151);
    }
    for (const text of [question.question, ...Object.values(question.options)]) {
      assert.doesNotMatch(text, /Đáp án:|CÂU \d+ ĐẾN|CHI TIẾT ĐÁP ÁN|\ufffd/);
    }
  });
  assert.equal(questions[0].id, 8);
  assert.equal(questions[0].answer, 'A');
  assert.equal(data.defaultQuestionId, 1045);
});

test('all 160 authored questions teach a concept with explanations, sources and distinct choices', () => {
  assert.equal(authoredQuestions.length, 160);
  assert.equal(data.learningTotal, 160);
  assert.deepEqual(authoredQuestions.map(question => question.id), Array.from({ length: 160 }, (_, i) => 1045 + i));
  const topics = new Map();
  const answers = { A: 0, B: 0, C: 0, D: 0 };
  const stems = new Set();
  for (const question of authoredQuestions) {
    assert.equal(question.kind, 'learning');
    assert.ok(['medium', 'hard'].includes(question.difficulty));
    assert.ok(question.explanation.length >= 120);
    assert.equal(new Set(Object.values(question.options)).size, 4);
    assert.equal(question.printedPage, undefined);
    assert.ok(question.references.length > 0);
    for (const reference of question.references) {
      const url = new URL(reference.url);
      assert.equal(url.protocol, 'https:');
      assert.ok(['openstax.org', 'oceanservice.noaa.gov', 'www.nasa.gov', 'science.nasa.gov', 'www.usgs.gov', 'developer.mozilla.org', 'developers.google.com', 'www.postgresql.org', 'cs50.harvard.edu', 'ocw.mit.edu'].includes(url.hostname));
      assert.ok(reference.title.length > 5);
    }
    assert.doesNotMatch(question.question, /\b(?:19|20)\d{2}\b|Grammy|Oscar|World Cup/i);
    stems.add(question.question);
    topics.set(question.topic, (topics.get(question.topic) || 0) + 1);
    answers[question.answer]++;
  }
  assert.equal(stems.size, authoredQuestions.length);
  assert.equal(topics.size, 8);
  assert.ok([...topics.values()].every(count => count === 20));
  assert.deepEqual(answers, { A: 40, B: 40, C: 40, D: 40 });
});

test('supplementary explanations fill only missing book explanations and are labeled as authored', () => {
  const archived = new Map(bookQuestions.map(question => [question.id, question]));
  const active = new Map(questions.map(question => [question.id, question]));
  assert.equal(new Set(bookExplanations.map(item => item.id)).size, bookExplanations.length);
  for (const { id, explanation } of bookExplanations) {
    assert.equal(archived.get(id).explanation, undefined, `Book already explains ${id}`);
    assert.ok(explanation.length >= 120);
    assert.equal(active.get(id).explanation, explanation);
    assert.equal(active.get(id).explanationSource, 'authored');
  }
  const supplemented = new Set(bookExplanations.map(item => item.id));
  for (const question of questions) {
    if (!supplemented.has(question.id)) assert.equal(question.explanationSource, undefined);
  }
});

test('all retained Google links contain exactly the question stem and no extra query parameters', () => {
  for (const question of questions) {
    const url = new URL(googleSearchUrl(question));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('q'), question.question);
    assert.deepEqual([...url.searchParams.keys()], ['q']);
  }
});

test('search encoding preserves Vietnamese, quotes, question marks and special URL characters', () => {
  const question = { question: 'Ai viết "Sóng"? A&B + 50% #1 / thử', answer: 'SECRET', options: { A: 'DO NOT SEND' } };
  const url = new URL(googleSearchUrl(question));
  assert.equal(url.searchParams.get('q'), question.question);
  assert.ok(!url.href.includes('SECRET') && !url.href.includes('DO%20NOT%20SEND'));
});

test('invalid or old saved progress cannot break navigation or contaminate results', () => {
  for (const value of [null, false, 'bad', [], { currentId: 99999 }]) {
    const progress = validProgress(value, questions);
    assert.equal(progress.currentId, questions[0].id);
    assert.deepEqual(progress.results, {});
  }
  const progress = validProgress({ currentId: 1042, results: { 1: { selected: 'D' }, 11: { selected: 'B' }, 8: { selected: null }, 13: null, 99999: { selected: 'A' } }, notes: { 1: { insight: 'Removed' }, 8: { insight: 'Still relevant' } } }, questions);
  assert.equal(progress.currentId, 1042);
  assert.deepEqual(progress.results, { 11: { selected: 'B' }, 8: { selected: null } });
  assert.deepEqual(progress.notes, { 8: { insight: 'Still relevant', followup: '' } });
  assert.equal(validProgress({ currentId: 1 }, questions).currentId, 8);
});

test('random navigation avoids repeating the current question, including the last question', () => {
  assert.equal(randomQuestionId(questions, 8, () => 0), 11);
  assert.equal(randomQuestionId(questions, 1204, () => 0.999999), 1203);
  assert.equal(randomQuestionId([{ id: 1 }], 1), 1);
});

test('set-aside ambiguities are archived with original notes but excluded from active study', () => {
  const question = bookQuestions.find(question => question.id === 610);
  assert.ok(question.sourceNote);
  assert.equal(question.answer, 'C');
  assert.equal(questions.some(question => question.id === 610), false);
  assert.equal(questions.some(question => question.id === 107), false);
  for (const id of editorialIds) assert.equal(questions.some(question => question.id === id), false);
});

const { learningStatus, studyQueue, searchQuestions, normalizeText, createRelatedFinder } = require('../study-core.js');

test('the new learning queue contains only authored questions and retains saved new-question notes', () => {
  const progress = validProgress({ currentId: 1204, view: 'test', results: {
    8: { mastery: 'understood' }, 1045: { mastery: 'review' }, 1204: { mastery: 'understood' },
  }, notes: { 1204: { insight: 'GDP and welfare differ', followup: 'Which indicators complement it?' } } }, questions);
  assert.equal(progress.currentId, 1204);
  assert.equal(progress.notes[1204].insight, 'GDP and welfare differ');
  assert.deepEqual(studyQueue(questions, progress, 'learning'), authoredQuestions.map(question => question.id));
  assert.deepEqual(validProgress(JSON.parse(JSON.stringify(progress)), questions), progress);
  const snapshot = studyQueue(questions, progress, 'learning');
  progress.results[1046] = { mastery: 'understood' };
  assert.deepEqual(studyQueue(questions, progress, 'learning'), snapshot);
});

test('subject search works without accents and does not index hidden explanations or references', () => {
  const progress = validProgress(null, questions);
  assert.deepEqual(searchQuestions(questions, progress, 'xac suat va doc du lieu').map(question => question.id), authoredQuestions.filter(question => question.topic === 'Xác suất và đọc dữ liệu').map(question => question.id));
  assert.equal(searchQuestions(authoredQuestions, progress, 'OpenStax').length, 0);
  assert.equal(searchQuestions(authoredQuestions, progress, '585').length, 0); // Bayes denominator appears only in the explanation.
});

test('quantitative answer keys agree with independent calculations', () => {
  const correct = id => {
    const question = authoredQuestions.find(question => question.id === id);
    return question.options[question.answer];
  };
  const positiveRate = (100 * 0.9) / (100 * 0.9 + 9900 * 0.05);
  assert.equal(correct(1125), `${(positiveRate * 100).toFixed(1).replace('.', ',')}%`);
  assert.equal(correct(1077), `${100 / 2 ** 3}`.replace('.', ',') + '%');
  assert.equal(correct(1128), '3/10');
  assert.equal((3 / 5) * (2 / 4), 3 / 10);
  assert.equal(correct(1131), `${Math.round(100 * (1 - 0.95 ** 20))}%`);
  assert.equal(correct(1138), `${(10 * 9 + 30 * 7) / 40}`.replace('.', ','));
  assert.equal(correct(1146), `${240 / (120 / 60 + 120 / 40)} km/h`);
  assert.equal(correct(1147), `${2 ** (12 / 3)} lần`);
  assert.equal(correct(1149), (10 * 9 * 8 * 7).toLocaleString('vi-VN'));
  assert.equal(correct(1150), `${(8 * 7 * 6) / (3 * 2)}`);
  assert.equal(correct(1174), `${100 * 8 / 80} giây`);
  assert.equal(correct(1184), `${80 / 100 * 100}% và ${80 / 200 * 100}%`);
});

test('old answers migrate without treating a correct answer as understanding', () => {
  const progress = validProgress({ currentId: 2, results: { 1: { selected: 'D' }, 2: { selected: 'A' }, 3: { selected: null } } }, learningQuestions);
  assert.equal(progress.currentId, 2);
  assert.equal(progress.view, 'learn');
  assert.deepEqual(progress.notes, {});
  assert.equal(learningStatus(learningQuestions[0], progress), 'seen');
  assert.equal(learningStatus(learningQuestions[1], progress), 'review');
  assert.equal(learningStatus(learningQuestions[2], progress), 'seen');
  assert.equal(learningStatus(learningQuestions[3], progress), 'unseen');
  assert.deepEqual(studyQueue(learningQuestions, progress, 'review'), [1, 2, 3]);
});

test('review excludes explicitly understood questions but retains unassessed ones', () => {
  const progress = validProgress({ results: {
    1: { selected: 'D', mastery: 'review' },
    2: { selected: 'D', mastery: 'understood' },
    3: { selected: null },
    4: { selected: 'A', mastery: 'understood' },
  } }, learningQuestions);
  assert.deepEqual(studyQueue(learningQuestions, progress, 'review'), [1, 3]);
  assert.equal(learningStatus(learningQuestions[3], progress), 'understood');
  assert.equal(studyQueue(learningQuestions, progress, 'unseen')[0], 5);
  assert.equal(studyQueue(learningQuestions, progress).length, learningQuestions.length);
});

test('a queue snapshot stays stable as questions are viewed and rated', () => {
  const progress = validProgress(null, questions);
  const unseen = studyQueue(questions, progress, 'unseen');
  progress.results[8] = { selected: null, mastery: 'understood' };
  assert.deepEqual(unseen.slice(0, 3), [8, 11, 13]);
  assert.equal(studyQueue(questions, progress, 'unseen')[0], 11);
});

test('saved understanding, view, and per-question notes survive validation', () => {
  const progress = validProgress({ view: 'test', results: { 8: { selected: 'A', mastery: 'understood' } }, notes: {
    8: { insight: 'Palawan, Philippines', followup: 'Vì sao có sông ngầm?' },
    13: { insight: '   ', followup: '' },
    99999: { insight: 'unknown' },
    '__proto__': { insight: 'bad' },
  } }, questions);
  assert.equal(progress.view, 'test');
  assert.equal(progress.results[8].mastery, 'understood');
  assert.deepEqual(progress.notes, { 8: { insight: 'Palawan, Philippines', followup: 'Vì sao có sông ngầm?' } });
  assert.deepEqual(validProgress(JSON.parse(JSON.stringify(progress)), questions), progress);
});

test('malformed stored notes and mastery are sanitized without losing valid progress', () => {
  const progress = validProgress({ view: 'invalid', results: { 11: { selected: 'B', mastery: 'anything' }, '011': { selected: 'A' } }, notes: {
    11: { insight: 'x'.repeat(4000), followup: 4 }, 8: null, 13: { insight: {}, followup: 'A new question' },
  } }, questions);
  assert.equal(progress.view, 'learn');
  assert.deepEqual(progress.results, { 11: { selected: 'B' } });
  assert.equal(progress.notes[11].insight.length, 3000);
  assert.equal(progress.notes[11].followup, '');
  assert.equal(progress.notes[8], undefined);
  assert.equal(progress.notes[13].insight, '');
  assert.equal(progress.notes[13].followup, 'A new question');
});

test('Vietnamese library search accepts accents, no accents, and mixed case', () => {
  const progress = validProgress(null, questions);
  assert.equal(normalizeText('Địa danh ĐÈN'), 'dia danh den');
  for (const query of ['Dạ Trạch Vương', 'da trach vuong', 'DẠ TRẠCH VƯƠNG', 'trieu viet vuong']) {
    assert.ok(searchQuestions(questions, progress, query).some(question => question.id === 21), query);
  }
  assert.equal(searchQuestions(questions, progress, 'zzzz-nothing').length, 0);
  assert.deepEqual(searchQuestions(questions, progress, '1042').map(question => question.id), [1042]);
});

test('library filters combine with search and expose saved notes', () => {
  const progress = validProgress({ results: { 11: { mastery: 'understood' }, 8: { selected: null }, 13: { mastery: 'review' } }, notes: { 8: { insight: 'An idea' } } }, questions);
  assert.deepEqual(searchQuestions(questions, progress, '', 'understood').map(question => question.id), [11]);
  assert.deepEqual(searchQuestions(questions, progress, '', 'review').map(question => question.id), [8, 13]);
  assert.deepEqual(searchQuestions(questions, progress, 'puerto', 'notes').map(question => question.id), [8]);
  assert.equal(searchQuestions(questions, progress, '', 'unseen').length, questions.length - 3);
});

test('related navigation is deterministic, excludes the current question, and gives actual shared terms', () => {
  const related = createRelatedFinder(questions);
  const question = questions.find(question => question.id === 421);
  const matches = related(question);
  assert.equal(matches[0].question.id, 191);
  assert.ok(matches.length <= 3);
  assert.deepEqual(related(question), matches);
  for (const match of matches) {
    assert.notEqual(match.question.id, question.id);
    const original = `${question.question} ${question.options[question.answer]}`.toLowerCase();
    const target = `${match.question.question} ${match.question.options[match.question.answer]}`.toLowerCase();
    for (const keyword of match.keywords) {
      assert.ok(original.includes(keyword), keyword);
      assert.ok(target.includes(keyword), keyword);
    }
  }
});

test('related matching preserves accents and avoids unrelated distractors', () => {
  const fixture = [
    { id: 1, question: 'Tiểu thuyết nào?', options: { A: 'Tắt đèn' }, answer: 'A' },
    { id: 2, question: 'Trồng tiêu sao?', options: { A: 'Cây tiêu' }, answer: 'A' },
    { id: 3, question: 'Tác giả tiểu thuyết Tắt đèn?', options: { A: 'Ngô Tất Tố' }, answer: 'A' },
    ...Array.from({ length: 30 }, (_, i) => ({ id: i + 4, question: 'Câu khác', options: { A: `Riêng ${i}` }, answer: 'A' })),
  ];
  const matches = createRelatedFinder(fixture)(fixture[0]);
  assert.equal(matches[0].question.id, 3);
  assert.ok(!matches.some(match => match.question.id === 2));
});
