import { formatFrequency } from '@/lib/radio/band';
import { QRL_LISTEN, type FrequencyUse, type RunIssue } from '@/lib/radio/modes/cqRun';
import type { RunDeskFlavor } from './RunDesk';
import type { RunReviewFlavor } from './RunReview';

/** The CQ run's words and sections for the shared run desk and review. */

const ISSUE_TEXT: Record<RunIssue, string> = {
  'cq-without-call': 'CQ に自分のコールが入っていません。誰が呼んでいるのか相手にわかりません',
  'no-call': '複数の局が呼んでいます。誰に送ったのかわかるよう、相手のコールを付けましょう',
  'cq-without-qrl': 'QRL? を出さずに CQ を出しました。この周波数は使用中です。VFO を動かし、聴いて F6（QRL?）で確かめてから CQ を出しましょう',
  'busy-frequency': 'QRL? は出しましたが、この周波数は使用中でした（返事や近くの信号がありました）。QRL? のあと数秒聴き、空いていなければ QSY してから CQ を出しましょう',
  'qrl-no-listen': 'QRL? のあと聴かずに CQ を出しました。QRL? は、そのあと数秒聴いて返事がないことを確かめるまでが確認です',
};
/** A CQ on someone else's QSO stops CQ repeat: moving is the operator's call. */
const BUSY_ISSUES: RunIssue[] = ['cq-without-qrl', 'busy-frequency'];
const QRL_ANSWERED = 'QRL? に返事がありました。この周波数は使用中です。VFO を動かして別の周波数を探しましょう';
const QSY_ASKED = 'この周波数で交信中の局から QSY を求められています。VFO を 1 kHz ほど動かし、聴いて QRL? で確かめてから CQ を出しましょう';
const CQ_HELD = 'QRL? のあと聴いています。数秒たって空いていれば CQ を出します（Esc で取消）';
const CQ_CANCELLED = 'QRL? のあとに信号が聞こえたので、CQ の予約を取り消しました。この周波数は使用中です。VFO を動かして確かめ直しましょう';
const CQ_MOVED = 'VFO を動かしたので、CQ の予約を取り消しました。新しい周波数でも聴いて QRL? で確かめましょう';
/** Advice about a busy frequency, cleared once a CQ goes out clean elsewhere. */
const FREQUENCY_ADVICE = new Set([QRL_ANSWERED, QSY_ASKED, CQ_HELD, CQ_CANCELLED, CQ_MOVED, ...BUSY_ISSUES.map((issue) => ISSUE_TEXT[issue])]);

function frequencyLine(use: FrequencyUse) {
  const listened = use.qrlListen === null ? '' : use.qrlListen < QRL_LISTEN ? `（聴いたのは ${use.qrlListen.toFixed(1)} 秒）` : `（${Math.round(use.qrlListen)} 秒聴いて）`;
  const check = use.qrlFirst ? `QRL? で確かめて${listened}から CQ` : 'QRL? なしで CQ';
  const asked = use.qsyAsked ? `・QSY を ${use.qsyAsked} 回求められた` : '';
  return use.busyCqs ? `${check}・使用中に ${use.busyCqs} 回 CQ${asked}` : `${check}・空いていました${asked}`;
}

export const CQ_RUN_REVIEW: RunReviewFlavor = {
  slips: ({ stats }) => [
    ['使用中の周波数で CQ', stats.busyCqs, 'cause-procedure'],
    ['QRL? のあと聴かずに CQ', stats.qrlNoListen, 'cause-procedure'],
  ],
  good: ({ stats }) => [
    [`QRL? のあと聴いて確かめてから CQ`, stats.frequencyChecks ?? 0],
    ['使用中と分かって CQ を控えた', stats.busyAvoided ?? 0],
  ],
  sections: (result) => result.frequencies.length > 0 && (
    <div className="run-missed">
      <h3>周波数の確認</h3>
      <ul>{result.frequencies.map((use) => {
        const { main, sub } = formatFrequency(use.rf);
        return <li key={use.rf}><b>{main}.{sub}</b> — {frequencyLine(use)}</li>;
      })}</ul>
    </div>
  ),
  noContacts: '交信は成立しませんでした。CQ のあと、呼んでくる局のコールを聴き取って F2 で交換を送りましょう。',
  restartLabel: 'もう一度 CQ を出す',
};

export const CQ_RUN_DESK: RunDeskFlavor = {
  prefsKey: 'cwot.cqrun.prefs',
  issueText: ISSUE_TEXT,
  stopsRepeat: BUSY_ISSUES,
  advice: FREQUENCY_ADVICE,
  held: { listening: CQ_HELD, cancelled: CQ_CANCELLED, moved: CQ_MOVED },
  coachFor(note, run) {
    switch (note.type) {
      case 'corrected': return '訂正が来ています。相手のコールを聴き直して、正しいコールで送り直しましょう';
      case 'asked': return `${note.fields.map((field) => `${field}?`).join(' ')} と聞き返されています。その項目をもう一度送りましょう`;
      case 'exchanged': return '交換が届きました。ログに記入して（Enter）、F3（TU）で締めましょう';
      case 'gone':
        return run.contacts.some((contact) => contact.stationId === note.agent.id && contact.status === 'dropped')
          ? '交信中の局が去りました。F1 で CQ に戻りましょう' : null;
      case 'qrl-answered': return QRL_ANSWERED;
      case 'qsy-asked': return QSY_ASKED;
      default: return null;
    }
  },
  idlePrompt: (powered) => (powered
    ? 'まず周波数を聴き、F6（QRL?）で使用中でないか確かめましょう。返事がなければ F1 で CQ。CQ の合間には呼んでくる局をよく聴いてください'
    : '電源を入れ、周波数を聴いて F6（QRL?）で確かめてから F1 で CQ を出しましょう'),
  profileNote: 'CQ Run では F2 で自分の名前と QTH を送ります。ローマ字で入れてください（あとで設定から変えられます）。',
  help: (
    <p className="qso-note">
      <kbd>F1</kbd>〜<kbd>F8</kbd> メモリー送信　<kbd>Esc</kbd> CQ リピート停止（送信待ちも取消）　送信中に押したキーは、今の送信が終わるとすぐ送ります。CQ の前に <kbd>F6</kbd> QRL? を出し、数秒聴いて返事がないことを確かめます（QRL? の直後に F1 を押すと、聴き終えてから CQ を出し、その間に信号が聞こえたら取り消します）。返事があれば VFO を動かして（QSY）確かめ直します。CQ リピートは、呼んでいる局が送り終えてから間隔を数えます。CALL 欄に <code>3AB?</code> と入れて <kbd>F5</kbd> で部分コール。
      正誤は QRT のあとにまとめて表示します。
    </p>
  ),
  // QSOs already going on: maybe right here (QRL? finds out), a few more up and down the band.
  setup: (run, engine) => { run.populate(engine.vfo, engine.now()); },
  review: CQ_RUN_REVIEW,
};
