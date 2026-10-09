import { stampInitialRevisions } from './model.mjs';

const text = (value) => [{ t: 'text', v: value }];
const paragraph = (value) => [{ t: 'p', body: text(value) }];

function single(setId, number, polarity) {
  const id = `${setId}-A${String(number).padStart(2, '0')}`;
  return {
    id,
    section: 'A',
    number,
    revision: 1,
    format: 'single',
    polarity,
    lead: text(`架空無線規則の規定に照らし、${polarity === 'negative' ? '適合しないもの' : '該当するもの'}はどれか。下の１から４までのうちから一つ選べ。`),
    body: [],
    legalRefs: [{ law: '架空無線規則', lawId: null, raw: '架空無線規則（第１条）', provisions: [{ article: '1' }] }],
    tags: [],
    variantGroup: null,
    explanation: null,
    choices: [1, 2, 3, 4].map((no) => ({ no, body: paragraph(`架空の選択肢${number}-${no}`) })),
    answer: 1,
    points: 5,
  };
}

function combination(setId) {
  return {
    id: `${setId}-A02`,
    section: 'A',
    number: 2,
    revision: 1,
    format: 'combination',
    lead: text('架空無線規則（第１２条）の規定に照らし、　内に入れるべき最も適切な字句の組合せを下の１から４までのうちから一つ選べ。'),
    body: [
      { t: 'item', marker: '①', body: [...text('申請者は、'), { t: 'blank', label: 'Ａ' }, ...text('。')] },
      { t: 'item', marker: '②', body: [...text('変更後の'), { t: 'blank', label: 'Ｂ' }, ...text('は届け出る。')] },
    ],
    legalRefs: [{ law: '架空無線規則', lawId: null, raw: '架空無線規則（第１２条）', provisions: [{ article: '12' }] }],
    tags: [],
    variantGroup: null,
    explanation: null,
    columns: ['Ａ', 'Ｂ'],
    rows: [1, 2, 3, 4].map((no) => ({
      no,
      cells: [text(`甲${no}`), text(`乙${no}`)],
    })),
    answer: 2,
    points: 5,
  };
}

function judge(setId, number) {
  const id = `${setId}-B${String(number).padStart(2, '0')}`;
  const labels = ['ア', 'イ', 'ウ', 'エ', 'オ'];
  const suffix = { ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o' };
  return {
    id,
    section: 'B',
    number,
    revision: 1,
    format: 'judge',
    lead: text('次の記述のうち、架空無線規則の規定に適合するものを１、適合しないものを２として解答せよ。'),
    body: [],
    legalRefs: [{ law: '架空無線規則', lawId: null, raw: '架空無線規則（第１２条）', provisions: [{ article: '12' }] }],
    tags: [],
    variantGroup: null,
    explanation: null,
    labels: { 1: '適合する', 2: '適合しない' },
    items: labels.map((label, index) => ({
      id: `${id}-${suffix[label]}`,
      label,
      body: paragraph(`架空の記述${number}-${label}`),
      answer: index % 2 === 0 ? 1 : 2,
    })),
    pointsEach: 1,
  };
}

function wordBank(setId) {
  const id = `${setId}-B02`;
  const labels = ['ア', 'イ', 'ウ', 'エ', 'オ'];
  const suffix = { ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o' };
  return {
    id,
    section: 'B',
    number: 2,
    revision: 1,
    format: 'wordBank',
    lead: text('架空無線規則の規定に照らし、　内に入れるべき最も適切な字句を下の１から５までのうちからそれぞれ一つ選べ。'),
    body: [
      {
        t: 'item',
        marker: '①',
        body: [...text('局は'), { t: 'blank', label: 'ア' }, ...text('を守り、'), { t: 'blank', label: 'イ' }, ...text('する。')],
      },
      { t: 'item', marker: '②', body: [...text('報告は'), { t: 'blank', label: 'ウ' }, ...text('に行う。')] },
      { t: 'item', marker: '③', body: [...text('記録は'), { t: 'blank', label: 'エ' }, ...text('とし、'), { t: 'blank', label: 'オ' }, ...text('保存する。')] },
    ],
    legalRefs: [{ law: '架空無線規則', lawId: null, raw: '架空無線規則（第３条）', provisions: [{ article: '3' }] }],
    tags: [],
    variantGroup: null,
    explanation: null,
    bank: [1, 2, 3, 4, 5].map((no) => ({ no, body: text(`架空語${no}`) })),
    items: labels.map((label, index) => ({ id: `${id}-${suffix[label]}`, label, answer: index + 1 })),
    pointsEach: 1,
  };
}

export function fictionalExam() {
  const setId = 'fx-houki-2099-03';
  const questions = [];
  for (let number = 1; number <= 20; number += 1) {
    questions.push(number === 2 ? combination(setId) : single(setId, number, number === 3 ? 'negative' : 'positive'));
  }
  questions.push(judge(setId, 1), wordBank(setId), judge(setId, 3), judge(setId, 4), judge(setId, 5));
  return stampInitialRevisions({
    kind: 'kakomon',
    schemaVersion: 1,
    id: setId,
    contentVersion: 1,
    qualification: '1sou',
    subject: 'houki',
    exam: { year: 2099, month: 3, label: '架空２０９９年３月期', code: 'FX2099', durationMin: 150 },
    scoring: {
      fullMarks: 125,
      passMark: 75,
      sectionA: { count: 20, pointsEach: 5 },
      sectionB: { count: 5, pointsEach: 1, mode: 'perSubItem' },
      note: '架空の配点',
    },
    source: {
      questionPdf: 'fictional.pdf',
      answerPdf: 'fictional-kaitou.pdf',
      questionPdfSha256: '0'.repeat(64),
      answerPdfSha256: '1'.repeat(64),
      extractedWith: 'fixture',
    },
    distribution: 'private',
    rights: {
      status: 'unconfirmed',
      termsId: null,
      publicationEvidence: [],
      holds: [],
      approvedBy: null,
      approvedAt: null,
    },
    attribution: {
      organization: '公益財団法人日本無線協会',
      qualificationLabel: '第一級総合無線通信士',
      subjectLabel: '法規',
    },
    review: { transcription: 'draft', checkedBy: null, checkedAt: null },
    questions,
    questionRevisions: [],
  }, '2100-01-10T09:00:00+09:00');
}
