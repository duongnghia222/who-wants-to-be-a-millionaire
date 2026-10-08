(function (root) {
  'use strict';

  function googleSearchUrl(question) {
    // Keep the original question-only search contract.
    return 'https://www.google.com/search?q=' + encodeURIComponent(question.question);
  }

  function validProgress(value, questions) {
    const clean = { currentId: questions[0].id, results: {}, notes: {}, view: 'learn' };
    if (!value || typeof value !== 'object') return clean;
    const known = new Set(questions.map(question => question.id));
    if (known.has(value.currentId)) clean.currentId = value.currentId;
    if (value.view === 'test') clean.view = 'test';
    if (value.results && typeof value.results === 'object') {
      for (const [id, result] of Object.entries(value.results)) {
        if (!/^[1-9]\d*$/.test(id) || !known.has(Number(id)) || !result || typeof result !== 'object') continue;
        const selected = /^[ABCD]$/.test(result.selected) ? result.selected : null;
        clean.results[id] = { selected };
        if (['review', 'understood'].includes(result.mastery)) clean.results[id].mastery = result.mastery;
      }
    }
    if (value.notes && typeof value.notes === 'object') {
      for (const [id, note] of Object.entries(value.notes)) {
        if (!/^[1-9]\d*$/.test(id) || !known.has(Number(id)) || !note || typeof note !== 'object') continue;
        const insight = typeof note.insight === 'string' ? note.insight.slice(0, 3000) : '';
        const followup = typeof note.followup === 'string' ? note.followup.slice(0, 3000) : '';
        if (insight.trim() || followup.trim()) clean.notes[id] = { insight, followup };
      }
    }
    return clean;
  }

  function learningStatus(question, progress) {
    const result = progress.results[question.id];
    if (!result) return 'unseen';
    if (result.mastery) return result.mastery;
    return result.selected && result.selected !== question.answer ? 'review' : 'seen';
  }

  function studyQueue(questions, progress, scope = 'all') {
    return questions.filter(question => {
      const status = learningStatus(question, progress);
      if (scope === 'learning') return question.kind === 'learning';
      if (scope === 'review') return status === 'review' || status === 'seen';
      if (scope === 'unseen') return status === 'unseen';
      return true;
    }).map(question => question.id);
  }

  function normalizeText(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }

  function searchQuestions(questions, progress, query = '', filter = 'all') {
    const words = normalizeText(query).trim().split(/\s+/).filter(Boolean);
    return questions.filter(question => {
      const status = learningStatus(question, progress);
      if (filter === 'review' && status !== 'review' && status !== 'seen') return false;
      if (filter === 'unseen' && status !== 'unseen') return false;
      if (filter === 'understood' && status !== 'understood') return false;
      if (filter === 'notes' && !progress.notes[question.id]) return false;
      // Search stems, choices and topics, never personal notes or hidden explanations.
      const text = normalizeText(`${question.id} ${question.topic || ''} ${question.question} ${Object.values(question.options).join(' ')}`);
      return words.every(word => text.includes(word));
    });
  }

  function randomQuestionId(questions, currentId, random = Math.random) {
    const choices = questions.filter(question => question.id !== currentId);
    return choices.length ? choices[Math.floor(random() * choices.length)].id : currentId;
  }

  function createRelatedFinder(questions) {
    // Lexical navigation, not a claim that two questions teach the same concept.
    const stop = new Set(('ai là của và ở đâu nào một những các trong được có gì thuộc với cho về từ khi đến theo tại năm nước tên loại nhất sau đây thế thứ mấy bằng bao nhiêu dưới trên nơi này đó chính thức biết tiếng').split(' '));
    const documents = new Map();
    const frequency = new Map();
    for (const question of questions) {
      const terms = new Set();
      for (const text of [question.question, question.options[question.answer]]) {
        const tokens = text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        const useful = term => term.length >= 2 && !stop.has(term) && !/^\d+$/.test(term);
        for (let index = 0; index < tokens.length; index++) {
          const term = tokens[index];
          if (!useful(term)) continue;
          // Preserve accents: “tiểu” and “tiêu”, “lễ” and “lệ” are different ideas.
          terms.add(term);
          if (tokens[index + 1] && useful(tokens[index + 1])) terms.add(`${term} ${tokens[index + 1]}`);
        }
      }
      documents.set(question.id, terms);
      for (const term of terms) frequency.set(term, (frequency.get(term) || 0) + 1);
    }
    return function relatedQuestions(question, limit = 3) {
      const own = documents.get(question.id) || new Set();
      return questions.filter(other => other.id !== question.id).map(other => {
        const shared = [...documents.get(other.id)].filter(term => own.has(term) && frequency.get(term) < questions.length / 8);
        if (shared.length < 3 && !shared.some(term => term.includes(' ') || (term.length >= 4 && frequency.get(term) <= 8))) return null;
        shared.sort((a, b) => Number(b.includes(' ')) - Number(a.includes(' ')) || frequency.get(a) - frequency.get(b));
        const keywords = shared.filter(term => term.includes(' ') || !shared.some(phrase => phrase.includes(' ') && phrase.split(' ').includes(term)));
        const score = shared.reduce((sum, term) => sum + (term.includes(' ') ? 2 : 1) * Math.log((questions.length + 1) / (frequency.get(term) + 1)), 0) / Math.sqrt(documents.get(other.id).size || 1);
        return { question: other, keywords: keywords.slice(0, 3), score };
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.question.id - b.question.id).slice(0, limit);
    };
  }

  const core = { googleSearchUrl, validProgress, learningStatus, studyQueue, normalizeText, searchQuestions, randomQuestionId, createRelatedFinder };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  else root.StudyCore = core;
})(typeof window !== 'undefined' ? window : globalThis);
