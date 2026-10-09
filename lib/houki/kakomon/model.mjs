import { createHash } from 'node:crypto';

const SUBJECTS = new Set(['houki', 'kiso', 'kougakuA', 'kougakuB']);
const SUB_LABEL = { ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o' };
const SUB_ORDER = ['ア', 'イ', 'ウ', 'エ', 'オ'];

export function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function contentPayload(question) {
  const base = { format: question.format, lead: question.lead, body: question.body };
  if (question.format === 'single') return { ...base, polarity: question.polarity, choices: question.choices };
  if (question.format === 'combination') return { ...base, columns: question.columns, rows: question.rows };
  if (question.format === 'judge') {
    return {
      ...base,
      labels: question.labels,
      items: question.items.map(({ id, label, body }) => ({ id, label, body })),
    };
  }
  return {
    ...base,
    bank: question.bank,
    items: question.items.map(({ id, label }) => ({ id, label })),
  };
}

export function answerPayload(question) {
  if (question.format === 'single' || question.format === 'combination') return { answer: question.answer };
  return { items: question.items.map(({ id, answer }) => ({ id, answer })) };
}

export function contentDigest(question) {
  return `sha256:${sha256(stableStringify(contentPayload(question)))}`;
}

export function answerDigest(question) {
  return `sha256:${sha256(stableStringify(answerPayload(question)))}`;
}

export function stampInitialRevisions(exam, at) {
  exam.questionRevisions = exam.questions.map((question) => ({
    questionId: question.id,
    revision: 1,
    contentDigest: contentDigest(question),
    answerDigest: answerDigest(question),
    change: 'initial',
    at,
    erratumIds: [],
  }));
  for (const question of exam.questions) question.revision = 1;
  return exam;
}

export function blankLabels(question) {
  const labels = [];
  const walkInline = (items) => {
    for (const item of items ?? []) if (item?.t === 'blank') labels.push(item.label);
  };
  const walkBlock = (blocks) => {
    for (const block of blocks ?? []) {
      walkInline(block.body);
      if (block.children) walkBlock(block.children);
    }
  };
  walkInline(question.lead);
  walkBlock(question.body);
  return labels;
}

function walkStrings(value, fn) {
  if (typeof value === 'string') fn(value);
  else if (Array.isArray(value)) for (const item of value) walkStrings(item, fn);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) walkStrings(item, fn);
}

function unique(values) {
  return [...new Set(values)];
}

export function validateExamSet(exam, options = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!exam || exam.kind !== 'kakomon' || exam.schemaVersion !== 1) fail('kind と schemaVersion が不正');
  if (!SUBJECTS.has(exam?.subject)) fail(`subject が対象外: ${exam?.subject ?? ''}`);
  if (exam?.qualification !== '1sou') fail('qualification が 1sou ではない');
  if (!/^(?:1sou-(?:houki|kiso|kougakuA|kougakuB)|fx-houki)-\d{4}-(?:03|09)$/.test(exam?.id ?? '')) fail(`回 ID が不正: ${exam?.id ?? ''}`);
  if (!Array.isArray(exam?.questions)) return ['questions がない'];

  const expected = [];
  for (let number = 1; number <= 20; number += 1) expected.push(`${exam.id}-A${String(number).padStart(2, '0')}`);
  for (let number = 1; number <= 5; number += 1) expected.push(`${exam.id}-B${String(number).padStart(2, '0')}`);
  const ids = exam.questions.map((question) => question.id);
  if (ids.join(',') !== expected.join(',')) fail('A01〜A20 と B01〜B05 が順に揃っていない');

  let points = 0;
  for (const question of exam.questions) {
    points += questionPoints(question);
    errors.push(...validateQuestion(exam.id, question));
    errors.push(...validateRevision(exam, question));
  }
  if (exam.scoring?.fullMarks !== points) fail(`配点合計 ${points} が fullMarks ${exam.scoring?.fullMarks} と違う`);
  if (exam.review?.transcription === 'approved' && (!exam.review.checkedBy || !exam.review.checkedAt)) {
    fail('approved には確認者の記録が必要');
  }
  const allowedGroups = new Set(options.variantGroupIds ?? []);
  for (const question of exam.questions) {
    if (question.variantGroup && !allowedGroups.has(question.variantGroup)) fail(`${question.id} の variantGroup が未確認`);
  }
  if (options.questionPdfSha256 && exam.source?.questionPdfSha256 !== options.questionPdfSha256) fail('問題 PDF の SHA-256 が一致しない');
  if (options.answerPdfSha256 && exam.source?.answerPdfSha256 !== options.answerPdfSha256) fail('正答 PDF の SHA-256 が一致しない');
  errors.push(...validatePublication(exam));
  walkStrings(exam, (value) => {
    if (value.includes('\uFFFD')) fail('置換文字 U+FFFD がある');
    if (/[\uFF61-\uFF9F]/.test(value)) fail('半角カナがある');
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) fail('制御文字がある');
  });
  return errors;
}

function questionPoints(question) {
  if (question.format === 'single' || question.format === 'combination') return question.points ?? 0;
  return (question.pointsEach ?? 0) * (question.items?.length ?? 0);
}

function validateQuestion(setId, question) {
  const errors = [];
  const fail = (message) => errors.push(`${question.id}: ${message}`);
  if (question.format === 'single') {
    const count = question.choices?.length ?? 0;
    if (count !== 4 && count !== 5) fail('選択肢は 4 個か 5 個');
    question.choices?.forEach((choice, index) => {
      if (choice.no !== index + 1) fail('選択肢番号が連番ではない');
    });
    if (question.answer < 1 || question.answer > count) fail('正答が選択肢の範囲外');
    if (question.points !== 5) fail('A 問題の配点は 5');
  } else if (question.format === 'combination') {
    const labels = unique(blankLabels(question));
    const columns = question.columns ?? [];
    if (labels.slice().sort().join(',') !== columns.slice().sort().join(',')) fail('空欄ラベルと列が一致しない');
    const nos = question.rows?.map((row) => row.no) ?? [];
    if (new Set(nos).size !== nos.length || nos.some((no) => !Number.isInteger(no) || no < 1)) fail('組合せの行番号が不正');
    question.rows?.forEach((row) => {
      if (row.cells?.length !== columns.length) fail('行のセル数が列数と違う');
    });
    if (!nos.includes(question.answer)) fail('正答が行番号の範囲外');
    if (question.points !== 5) fail('A 問題の配点は 5');
  } else if (question.format === 'judge') {
    if (question.items?.length !== 5) fail('正誤は小設問 5 個');
    question.items?.forEach((item, index) => {
      const label = SUB_ORDER[index];
      if (item.label !== label) fail('小設問ラベルがア〜オの順ではない');
      if (item.id !== `${question.id}-${SUB_LABEL[label]}`) fail('小設問 ID が不正');
      if (item.answer !== 1 && item.answer !== 2) fail('正誤の正答は 1 か 2');
    });
    if (question.pointsEach !== 1) fail('小設問の配点は 1');
  } else if (question.format === 'wordBank') {
    const labels = unique(blankLabels(question));
    const itemLabels = question.items?.map((item) => item.label) ?? [];
    if (new Set(itemLabels).size !== itemLabels.length) fail('語群の採点ラベルが重複している');
    if (labels.slice().sort().join(',') !== itemLabels.slice().sort().join(',')) fail('本文の空欄と語群の採点対象が一致しない');
    const bankNos = question.bank?.map((entry) => entry.no) ?? [];
    if (bankNos.join(',') !== bankNos.map((_, index) => index + 1).join(',')) fail('語群番号が 1 からの連番ではない');
    for (const item of question.items ?? []) {
      if (!bankNos.includes(item.answer)) fail('語群の正答が語群番号の範囲外');
      if (item.id !== `${question.id}-${SUB_LABEL[item.label]}`) fail('語群の小設問 ID が不正');
    }
    if (question.pointsEach !== 1) fail('小設問の配点は 1');
  } else fail('未知の形式');
  if (!question.id?.startsWith(`${setId}-`)) fail('問題 ID が回 ID で始まっていない');
  return errors;
}

function validateRevision(exam, question) {
  const revisions = (exam.questionRevisions ?? [])
    .filter((revision) => revision.questionId === question.id)
    .sort((a, b) => a.revision - b.revision);
  if (!revisions.length) return [`${question.id}: revision がない`];
  const errors = [];
  revisions.forEach((revision, index) => {
    if (revision.revision !== index + 1) errors.push(`${question.id}: revision が 1 からの連番ではない`);
  });
  const latest = revisions[revisions.length - 1];
  if (question.revision !== latest.revision) errors.push(`${question.id}: revision が履歴の最新と違う`);
  if (latest.contentDigest !== contentDigest(question)) errors.push(`${question.id}: contentDigest が一致しない`);
  if (latest.answerDigest !== answerDigest(question)) errors.push(`${question.id}: answerDigest が一致しない`);
  return errors;
}

function validatePublication(exam) {
  if (exam.distribution !== 'public') return [];
  const errors = [];
  const evidence = exam.rights?.publicationEvidence ?? [];
  const sufficient = evidence.some((item) => item.kind !== 'pdfInternal' && item.url);
  if (exam.rights?.status !== 'eligible') errors.push('public には rights.status eligible が必要');
  if (!sufficient) errors.push('public には pdfInternal 以外の公表根拠が必要');
  if ((exam.rights?.holds ?? []).some((hold) => !hold.resolvedAt)) errors.push('未解決の保留がある');
  if (!exam.rights?.approvedBy || !exam.rights?.approvedAt) errors.push('public には運営者の公開承認が必要');
  if (exam.review?.transcription !== 'approved') errors.push('public には起こしの approved が必要');
  return errors;
}

export function scanKakomonLeak(files) {
  const hits = [];
  for (const file of files) {
    if (file.text.includes('"kind": "kakomon"') || file.text.includes('"kind":"kakomon"')) hits.push(file.path);
  }
  return hits;
}
