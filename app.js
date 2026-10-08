(function () {
  'use strict';

  const data = window.STUDY_DATA;
  if (!data || !Array.isArray(data.questions) || !data.questions.length || !window.StudyCore) {
    document.getElementById('load-error').hidden = false;
    return;
  }

  const { googleSearchUrl, validProgress, learningStatus, studyQueue, searchQuestions, randomQuestionId, createRelatedFinder } = window.StudyCore;
  const questions = data.questions;
  const byId = new Map(questions.map(question => [question.id, question]));
  const indexById = new Map(questions.map((question, index) => [question.id, index]));
  const findRelated = createRelatedFinder(questions);
  // Retain the original key so existing answers and position migrate in place.
  const storageKey = 'trieu-phu-study-2018-v1';
  const format = new Intl.NumberFormat('vi-VN');
  const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
  const el = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
  const statusLabels = { unseen: 'Chưa học', seen: 'Đã xem', review: 'Cần ôn lại', understood: 'Đã hiểu' };
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch { saved = null; }
  const progress = validProgress(saved, questions);
  if (!byId.has(saved?.currentId) && byId.has(data.defaultQuestionId)) progress.currentId = data.defaultQuestionId;
  let scope = byId.get(progress.currentId).kind === 'learning' ? 'learning' : 'all';
  let queue = studyQueue(questions, progress, scope);
  let revealed = false;
  let selected = null;
  let finished = false;
  let libraryFilter = 'all';
  let libraryPage = 0;
  const pageSize = 25;
  const explorationTrail = [];

  function saveProgress() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(progress));
      return true;
    } catch {
      el['storage-note'].textContent = 'Chưa lưu được trên máy. Tiến độ và ghi chú chỉ giữ trong phiên này.';
      return false;
    }
  }

  function markViewed() {
    if (!progress.results[progress.currentId]) progress.results[progress.currentId] = { selected: null };
  }

  function updateProgress() {
    const seen = questions.filter(question => learningStatus(question, progress) !== 'unseen').length;
    const understood = questions.filter(question => learningStatus(question, progress) === 'understood').length;
    el['all-count'].textContent = format.format(questions.length);
    el['learning-count'].textContent = format.format(data.learningTotal);
    el['review-count'].textContent = format.format(studyQueue(questions, progress, 'review').length);
    el['unseen-count'].textContent = format.format(questions.length - seen);
    el['mastery-count'].textContent = `${format.format(understood)} / ${format.format(questions.length)}`;
    el['progress-bar'].max = questions.length;
    el['progress-bar'].value = understood;
    el['progress-count'].textContent = format.format(seen);
    el['progress-percent'].textContent = `${decimal.format(understood / questions.length * 100)}%`;
    const status = learningStatus(byId.get(progress.currentId), progress);
    el['question-status'].textContent = statusLabels[status];
    el['question-status'].className = `status-badge ${status}`;
  }

  function renderGrid() {
    const group = Math.floor(indexById.get(progress.currentId) / 50);
    el['chapter-select'].value = String(group);
    const fragment = document.createDocumentFragment();
    for (const question of questions.slice(group * 50, group * 50 + 50)) {
      const button = document.createElement('button');
      const status = learningStatus(question, progress);
      button.type = 'button';
      button.className = `grid-question ${status}${question.id === progress.currentId ? ' current' : ''}`;
      button.textContent = String(question.id);
      button.setAttribute('aria-label', `Câu ${question.id}, ${statusLabels[status]}`);
      if (question.id === progress.currentId) button.setAttribute('aria-current', 'true');
      button.addEventListener('click', () => openQuestion(question.id));
      fragment.append(button);
    }
    el['question-grid'].replaceChildren(fragment);
  }

  function renderOptions(question) {
    const fragment = document.createDocumentFragment();
    for (const [letter, text] of Object.entries(question.options)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      button.dataset.letter = letter;
      button.setAttribute('aria-label', `${letter}. ${text}`);
      const badge = document.createElement('span');
      badge.className = 'option-letter';
      badge.textContent = letter;
      badge.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = text;
      button.append(badge, label);
      if (revealed) {
        button.disabled = true;
        if (letter === question.answer || letter === selected) {
          const correct = letter === question.answer;
          button.classList.add(correct ? 'correct' : 'wrong');
          const status = document.createElement('span');
          status.className = 'option-status';
          status.textContent = correct ? '✓' : '✕';
          status.setAttribute('aria-hidden', 'true');
          button.append(status);
          button.setAttribute('aria-label', `${letter}. ${text}, ${correct ? 'đáp án đúng' : 'bạn đã chọn, chưa đúng'}`);
        }
      }
      button.addEventListener('click', () => reveal(letter));
      fragment.append(button);
    }
    el.options.replaceChildren(fragment);
  }

  function renderRelated(question) {
    const fragment = document.createDocumentFragment();
    const related = findRelated(question);
    for (const item of related) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'related-question';
      const number = document.createElement('span');
      number.className = 'related-number';
      number.textContent = `CÂU ${String(item.question.id).padStart(3, '0')} ↗`;
      const title = document.createElement('span');
      title.className = 'related-title';
      title.textContent = item.question.question;
      const keywords = document.createElement('span');
      keywords.className = 'related-keywords';
      keywords.textContent = `Từ khóa: ${item.keywords.join(' · ')}`;
      button.append(number, title, keywords);
      button.addEventListener('click', () => {
        explorationTrail.push({ scope, queue: [...queue], currentId: progress.currentId });
        openQuestion(item.question.id, true);
      });
      fragment.append(button);
    }
    if (!related.length) {
      const message = document.createElement('p');
      message.className = 'related-empty';
      message.textContent = 'Chưa tìm thấy câu có từ khóa gần nhau. Thử tìm theo tên riêng hoặc ý chính của câu hỏi.';
      fragment.append(message);
    }
    el['related-questions'].replaceChildren(fragment);
  }

  function showAnswer(question) {
    el['answer-section'].hidden = false;
    el['rating-section'].hidden = false;
    el['understanding-rail'].hidden = false;
    el['learning-layout'].classList.remove('testing');
    el['answer-text'].textContent = question.options[question.answer];
    el['answer-letter'].textContent = question.answer;
    el['explanation-text'].textContent = question.explanation || 'Tài liệu gốc chưa có giải thích cho câu này. Hãy tra cứu lý do và thử giải thích lại bằng lời của bạn.';
    el.explanation.classList.toggle('missing-explanation', !question.explanation);
    el['explanation-source'].hidden = !question.explanation;
    el['explanation-source'].textContent = question.kind === 'learning' ? 'Giải thích biên soạn · Đọc thêm từ nguồn bên dưới' : question.explanationSource === 'authored' ? 'Giải thích biên soạn bổ sung · Sách gốc không có giải thích' : 'Giải thích từ sách gốc';
    const sources = document.createDocumentFragment();
    for (const reference of question.references || []) {
      const link = document.createElement('a');
      link.href = reference.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = reference.title;
      sources.append(link);
    }
    el['reference-links'].replaceChildren(sources);
    el['reference-links'].hidden = !question.references?.length;
    el['source-note'].textContent = question.sourceNote || '';
    el['source-note'].hidden = !question.sourceNote;
    el['reveal-button'].hidden = true;
    el['source-caption'].hidden = false;
    el['source-caption'].textContent = question.kind === 'learning' ? 'Câu hỏi mở rộng · Học qua lý giải' : 'Đáp án theo tài liệu gốc';
    if (selected) {
      const correct = selected === question.answer;
      el.feedback.textContent = correct ? 'Bạn đã trả lời đúng. Hãy kiểm tra xem mình đã hiểu vì sao chưa.' : `Bạn chọn ${selected}. Đáp án là ${question.answer}. Câu này đã được thêm vào lượt ôn lại.`;
      el.feedback.className = `feedback ${correct ? 'correct' : 'wrong'}`;
      el.feedback.hidden = false;
    }
    renderRelated(question);
  }

  function renderHeading() {
    const headings = {
      all: ['HỌC TOÀN BỘ', 'Hiểu thêm một chút, mỗi ngày.', 'Học ý chính, hiểu lý do, rồi tự kiểm tra.'],
      learning: ['HỌC HIỂU SÂU', 'Học cách lý giải, không chỉ nhớ đáp án.', `${format.format(data.learningTotal)} câu hỏi mở rộng · 8 chủ đề · Có giải thích và nguồn đọc thêm.`],
      review: ['CẦN ÔN LẠI', 'Quay lại, để nhớ chắc hơn.', 'Những câu đã xem nhưng chưa đánh dấu đã hiểu.'],
      unseen: ['CHƯA HỌC', 'Mở thêm một cánh cửa kiến thức.', 'Tiếp tục với những câu bạn chưa xem đáp án.'],
    };
    const [eyebrow, title, description] = headings[scope];
    el['scope-eyebrow'].textContent = eyebrow;
    el['study-title'].textContent = title;
    el['scope-description'].textContent = description;
    document.querySelectorAll('[data-scope]').forEach(button => {
      button.classList.toggle('active', button.dataset.scope === scope);
      button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
    });
    el['learn-view'].setAttribute('aria-pressed', String(progress.view === 'learn'));
    el['test-view'].setAttribute('aria-pressed', String(progress.view === 'test'));
    el['view-hint'].textContent = progress.view === 'learn' ? 'Đọc đáp án · Hiểu ý chính' : 'Thử nhớ trước · Xem đáp án sau';
    el['return-button'].hidden = !explorationTrail.length;
    if (explorationTrail.length) el['return-button'].textContent = `← Về câu ${explorationTrail.at(-1).currentId}`;
  }

  function renderQuestion() {
    const question = byId.get(progress.currentId);
    finished = false;
    revealed = progress.view === 'learn';
    selected = null;
    el['empty-state'].hidden = true;
    el['learning-layout'].hidden = false;
    el['study-toolbar'].hidden = false;
    el['random-button'].disabled = queue.length < 2;
    el['question-number'].textContent = `CÂU ${String(question.id).padStart(3, '0')}`;
    el['question-text'].textContent = question.question;
    el['question-topic'].textContent = question.kind === 'learning' ? `${question.topic} · ${question.difficulty === 'hard' ? 'Khó' : 'Vận dụng'}` : '';
    el['question-topic'].hidden = question.kind !== 'learning';
    el['page-label'].hidden = !question.printedPage;
    el['page-label'].textContent = question.printedPage ? `Trang ${question.printedPage}` : '';
    el['google-link'].href = googleSearchUrl(question);
    el['google-link'].setAttribute('aria-label', `Tra cứu Google: ${question.question} (mở tab mới)`);
    el['feedback'].hidden = true;
    el['feedback'].textContent = '';
    el['answer-section'].hidden = !revealed;
    el['rating-section'].hidden = !revealed;
    el['understanding-rail'].hidden = !revealed;
    el['learning-layout'].classList.toggle('testing', !revealed);
    el['reveal-button'].hidden = revealed;
    el['source-caption'].hidden = !revealed;
    el['choices-disclosure'].open = !revealed;
    el['choices-disclosure'].classList.toggle('test-choices', !revealed);
    el['answer-prompt'].hidden = revealed;
    const note = progress.notes[question.id] || {};
    el['insight-note'].value = note.insight || '';
    el['followup-note'].value = note.followup || '';
    el['notes-panel'].open = Boolean(note.insight || note.followup);
    el['note-summary'].textContent = note.insight || note.followup ? 'Có ghi chú của bạn' : 'Biến thông tin thành kiến thức';
    el['note-save'].textContent = 'Ghi chú riêng, tự lưu trên máy này.';
    const index = queue.indexOf(question.id);
    el['previous-button'].disabled = index <= 0;
    el['next-label'].textContent = index === queue.length - 1 ? 'Hoàn tất lượt' : 'Câu tiếp';
    el['position-label'].textContent = `${format.format(index + 1)} / ${format.format(queue.length)}`;
    el['jump-input'].value = '';
    el['jump-input'].setCustomValidity('');
    if (revealed) {
      markViewed();
      showAnswer(question);
    }
    renderOptions(question);
    renderGrid();
    renderHeading();
    updateProgress();
    saveProgress();
  }

  function reveal(letter = null) {
    if (revealed || finished || !queue.length) return;
    const question = byId.get(progress.currentId);
    if (letter !== null && !Object.hasOwn(question.options, letter)) return;
    revealed = true;
    selected = letter;
    const previous = progress.results[question.id] || {};
    progress.results[question.id] = { ...previous, selected };
    if (letter && letter !== question.answer) progress.results[question.id].mastery = 'review';
    saveProgress();
    renderOptions(question);
    showAnswer(question);
    renderGrid();
    updateProgress();
    // Replaced option buttons cannot retain focus; move to the next useful action.
    el['mark-review'].focus({ preventScroll: true });
  }

  function focusQuestion() {
    el['question-text'].focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) el['study-toolbar'].scrollIntoView({ block: 'start' });
  }

  function navigate(id) {
    if (!queue.includes(id)) return;
    progress.currentId = id;
    renderQuestion();
    focusQuestion();
  }

  function openQuestion(id, exploring = false) {
    if (!byId.has(id)) return;
    if (!exploring) explorationTrail.length = 0;
    scope = 'all';
    queue = studyQueue(questions, progress);
    navigate(id);
  }

  function switchScope(nextScope) {
    explorationTrail.length = 0;
    scope = nextScope;
    // Snapshot the queue: viewing or rating a question must not skip the next one.
    queue = studyQueue(questions, progress, scope);
    renderHeading();
    updateProgress();
    if (!queue.length) return showEmpty(false);
    navigate(scope === 'all' && queue.includes(progress.currentId) ? progress.currentId : queue[0]);
  }

  function move(direction) {
    if (finished || !queue.length) return;
    const index = queue.indexOf(progress.currentId);
    if (direction > 0 && index === queue.length - 1) return showEmpty(true);
    if (queue[index + direction] !== undefined) navigate(queue[index + direction]);
  }

  function rate(mastery) {
    if (!revealed || finished) return;
    markViewed();
    progress.results[progress.currentId].mastery = mastery;
    saveProgress();
    updateProgress();
    move(1);
  }

  function showEmpty(completed) {
    finished = true;
    el['learning-layout'].hidden = true;
    el['study-toolbar'].hidden = true;
    el['empty-state'].hidden = false;
    el['random-button'].disabled = true;
    const reviewCount = studyQueue(questions, progress, 'review').length;
    const unseenCount = studyQueue(questions, progress, 'unseen').length;
    el['empty-title'].textContent = completed ? 'Bạn đã đi hết lượt này.' : scope === 'review' ? 'Chưa có câu cần ôn lại.' : 'Bạn đã xem toàn bộ câu hỏi.';
    el['empty-description'].textContent = completed
      ? `${format.format(reviewCount)} câu đã xem vẫn cần củng cố. ${format.format(unseenCount)} câu chưa học đang chờ bạn.`
      : scope === 'review' ? 'Học một câu mới. Những câu bạn chưa đánh dấu đã hiểu sẽ nằm ở đây.' : 'Quay lại những câu chưa chắc, hoặc tự kiểm tra để nhớ lâu hơn.';
    el['empty-primary'].textContent = reviewCount ? `Ôn lại ${format.format(reviewCount)} câu` : unseenCount ? 'Học câu chưa xem' : 'Tự kiểm tra lại';
    el['empty-title'].focus({ preventScroll: true });
  }

  function saveNotes() {
    const insight = el['insight-note'].value;
    const followup = el['followup-note'].value;
    if (insight.trim() || followup.trim()) progress.notes[progress.currentId] = { insight, followup };
    else delete progress.notes[progress.currentId];
    el['note-summary'].textContent = insight.trim() || followup.trim() ? 'Có ghi chú của bạn' : 'Biến thông tin thành kiến thức';
    el['note-save'].textContent = saveProgress() ? 'Đã lưu ghi chú trên máy này.' : 'Chưa lưu được. Ghi chú chỉ giữ trong phiên này.';
  }

  function renderLibrary() {
    const matches = searchQuestions(questions, progress, el['library-search'].value, libraryFilter);
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    libraryPage = Math.min(libraryPage, pages - 1);
    el['library-count'].textContent = `${format.format(matches.length)} câu hỏi${libraryFilter === 'review' ? ' · Đã xem, chưa đánh dấu đã hiểu' : ''}`;
    el['library-page'].textContent = `${libraryPage + 1} / ${pages}`;
    el['library-previous'].disabled = libraryPage === 0;
    el['library-next'].disabled = libraryPage === pages - 1;
    document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === libraryFilter)));
    const fragment = document.createDocumentFragment();
    for (const question of matches.slice(libraryPage * pageSize, (libraryPage + 1) * pageSize)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-result';
      const number = document.createElement('span');
      number.className = 'library-result-number';
      number.textContent = String(question.id).padStart(3, '0');
      const text = document.createElement('span');
      text.className = 'library-result-text';
      text.textContent = question.question;
      const badge = document.createElement('span');
      const status = learningStatus(question, progress);
      badge.className = `status-badge ${status}`;
      badge.textContent = statusLabels[status];
      button.append(number, text, badge);
      button.addEventListener('click', () => {
        el['library-dialog'].close();
        openQuestion(question.id);
      });
      fragment.append(button);
    }
    if (!matches.length) {
      const message = document.createElement('p');
      message.className = 'library-no-results';
      message.textContent = 'Chưa có câu phù hợp. Thử từ khóa ngắn hơn hoặc chọn “Tất cả”.';
      fragment.append(message);
    }
    el['library-results'].replaceChildren(fragment);
    el['library-results'].scrollTop = 0;
  }

  function openLibrary(query = '') {
    libraryPage = 0;
    libraryFilter = 'all';
    el['library-search'].value = query;
    renderLibrary();
    el['library-dialog'].showModal();
    el['library-search'].focus();
  }

  document.querySelector('.edition').textContent = `${format.format(questions.length)} câu đã chọn lọc · ${format.format(data.learningTotal)} câu mới có giải thích.`;
  el['jump-input'].min = questions[0].id;
  el['jump-input'].max = questions.at(-1).id;
  el['jump-input'].placeholder = `${questions[0].id} – ${questions.at(-1).id}`;
  for (let first = 0; first < questions.length; first += 50) {
    const option = document.createElement('option');
    option.value = String(first / 50);
    option.textContent = `Câu ${questions[first].id} – ${questions[Math.min(first + 49, questions.length - 1)].id}`;
    el['chapter-select'].append(option);
  }
  document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => switchScope(button.dataset.scope)));
  for (const view of ['learn', 'test']) el[`${view}-view`].addEventListener('click', () => {
    if (progress.view === view) return;
    progress.view = view;
    renderQuestion();
  });
  el['chapter-select'].addEventListener('change', () => openQuestion(questions[Number(el['chapter-select'].value) * 50].id));
  el['jump-form'].addEventListener('submit', event => {
    event.preventDefault();
    const id = Number(el['jump-input'].value);
    if (!byId.has(id)) {
      el['jump-input'].setCustomValidity('Câu này đã được loại khỏi bộ câu hỏi. Hãy chọn một số trong nhóm hoặc tìm trong thư viện.');
      el['jump-input'].reportValidity();
      return;
    }
    openQuestion(id);
  });
  el['jump-input'].addEventListener('input', () => el['jump-input'].setCustomValidity(''));
  el['previous-button'].addEventListener('click', () => move(-1));
  el['next-button'].addEventListener('click', () => move(1));
  el['random-button'].addEventListener('click', () => navigate(randomQuestionId(queue.map(id => byId.get(id)), progress.currentId)));
  el['reveal-button'].addEventListener('click', () => reveal());
  el['mark-review'].addEventListener('click', () => rate('review'));
  el['mark-understood'].addEventListener('click', () => rate('understood'));
  el['return-button'].addEventListener('click', () => {
    const previous = explorationTrail.pop();
    if (!previous) return;
    scope = previous.scope;
    queue = previous.queue;
    navigate(previous.currentId);
  });
  el['insight-note'].addEventListener('input', saveNotes);
  el['followup-note'].addEventListener('input', saveNotes);
  el['library-button'].addEventListener('click', () => openLibrary());
  el['explore-button'].addEventListener('click', () => openLibrary(byId.get(progress.currentId).options[byId.get(progress.currentId).answer]));
  el['close-library'].addEventListener('click', () => el['library-dialog'].close());
  el['library-search'].addEventListener('input', () => { libraryPage = 0; renderLibrary(); });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    libraryFilter = button.dataset.filter;
    libraryPage = 0;
    renderLibrary();
  }));
  el['library-previous'].addEventListener('click', () => { libraryPage--; renderLibrary(); });
  el['library-next'].addEventListener('click', () => { libraryPage++; renderLibrary(); });
  el['empty-primary'].addEventListener('click', () => {
    if (studyQueue(questions, progress, 'review').length) switchScope('review');
    else if (studyQueue(questions, progress, 'unseen').length) switchScope('unseen');
    else { progress.view = 'test'; progress.currentId = questions[0].id; switchScope('all'); }
  });
  el['empty-secondary'].addEventListener('click', () => { progress.currentId = questions[0].id; switchScope('all'); });

  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat) return;
    if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    // Let the modal own keyboard focus and Escape while it is open.
    if (el['library-dialog'].open) return;
    if (event.key === '/') { event.preventDefault(); openLibrary(); }
    else if (finished) return;
    else if (event.code === 'ArrowLeft') { event.preventDefault(); move(-1); }
    else if (event.code === 'ArrowRight') { event.preventDefault(); move(1); }
    else if (/^[a-d]$/i.test(event.key)) { event.preventDefault(); reveal(event.key.toUpperCase()); }
    else if (event.key === '1' || event.key === '2') { event.preventDefault(); rate(event.key === '1' ? 'review' : 'understood'); }
    else if (event.code === 'Space' && !event.target.closest('button, a, summary')) { event.preventDefault(); reveal(); }
  });

  renderQuestion();
  el.workspace.hidden = false;
})();
