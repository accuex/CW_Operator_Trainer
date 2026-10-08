/**
 * 試験問題セット生成 → data/exam/sets.json
 *
 * 使い方: npm run generate:exam-sets
 *         （または node scripts/generateExamSets.mjs）
 *
 * ────────────────────────────────────────────────────────────
 * 【役割分担】むやみに全部いじらない
 * ────────────────────────────────────────────────────────────
 * - data/exam/dicts.json … 固有名・局名など「肩書き」だけ
 * - このファイルの EN_SCENARIOS … 欧文本文のネタ
 * - scripts/exam/jaScenarios.mjs … 和文本文のネタ（表記ルールも同ファイル先頭）
 * - 下の COUNT / PAGE / targetWords / pagesToChars … 長さ・枚数
 * OCR練習帳の原文コピーは禁止（傾向だけ参考にして作文）。
 *
 * ────────────────────────────────────────────────────────────
 * 【dicts.json の書き方】
 * ────────────────────────────────────────────────────────────
 * - キー名を増やしたら、このスクリプト側の pick(dicts.xxx) も直すこと。
 * - 欧文系（originsLand / shipsEn / coastVia / personsEn / placesEn /
 *   firmsEn / signatures）:
 *   · すべて ASCII 大文字（A–Z 0–9 と / スペースのみ）
 *   · 船は { "name": "TOKYOMARU", "call": "JFPN" }（call は4文字コール）
 *   · 句読点・小文字・日本語文字を入れない
 * - 和文系（coastJa / shipsJa / personsJa / placesJa）:
 *   · カタカナのみ（ァ–ヶ・ー 可）。ひらがな・漢字・英字禁止
 *   · 長音は「ー」（例: トウキヨウ）。小さいャュョッは普通に使う
 *   · 「困ってる」→ コマツテイル（コミツテイルは誤り）
 *   · 「切符」→ キップ（キツプは誤り）
 *   · 「運動会」→ ウンドウカイ（ウンシオウカイは誤り）
 * - 追加したら意味の通る実在風の名前にすること（ランダム文字列禁止）。
 *
 * ────────────────────────────────────────────────────────────
 * 【EN_SCENARIOS の書き方】
 * ────────────────────────────────────────────────────────────
 * - すべて大文字。ピリオド等の句点は付けない（練習帳スタイル）
 * - 単語の羅列禁止。自然な英文（主語・動詞がある文）
 * - IT IS / THERE IS / AT THE / THESE / THAT など詰まりやすい語を意識
 * - 同じシナリオ内で「状況→経過→依頼」がつながるようにする
 * - 長さ合わせで切らない。composeEnBody が完結した候補から最も近いものを選ぶ
 *
 * ────────────────────────────────────────────────────────────
 * 【jaScenarios.mjs の書き方】★他AIが一番壊しやすいところ
 * ────────────────────────────────────────────────────────────
 * - カタカナのみ。ひらがな・漢字・英字・空白禁止（、は本文結合時に付くので
 *   フレーズ自体には入れない）。拗音・促音は大書き（シヨウ・ナツタ）
 * - 記号は （ ） のみ。直前の語の補足・言い換えに使う（コクテン（タイヨウノクロイハンテン））
 *   「「」は和文モールスに符号が無い。段落「」」は約1割の通で本題と結びの間に生成側が入れる
 * - 数量は num("3000", "サンゼン")。約1割の通だけ算用数字になる（JA_NUMERIC_RATE）
 * - opening / details / endings は同じ話題で統一し、順番にも意味を持たせる
 * - 書き出しと詳細には言い換え候補を pick で持たせ、1つの書き出しから
 *   続きが決まってしまわないようにする（例: エキデ→サイフ 固定は不可）
 * - 電報っぽい短文（だいたい 12–30 字）に分け、途中では切らない
 * - ローマ字変換の生出力を信じない。必ず音を頭で読んで確認:
 *   · 困っている → コマツテイル
 *   · 溜まって → タマツテ
 *   · 来て → キテ（キツテは「切って」）
 *   · お風呂 → オフロ（オンドセンは温泉→オンセン）
 * - 促音「ッ」と「ツ」を取り違えない（切符=キップ、切手≠）
 * - 濁音・半濁音を落とさない（運動会=ウンドウカイ）
 * - 下品・誹謗は入れない
 *
 * ────────────────────────────────────────────────────────────
 * 【長さ・セット構造（規定寄せ）】
 * ────────────────────────────────────────────────────────────
 * - 和文1セット = 2通、合計5枚（2+3 または 3+2）。1枚=PAGE字（本文）
 * - 欧文普通語1セット = 2通×各1枚。通あたりおおむね32–48語
 * - 暗語1セット = 2通×本文40グループ（5字×8×5）。Preamble/To は dicts から
 * - 字数を変えたいときは本文ネタではなく targetWords / pagesToChars を触る
 *
 * ────────────────────────────────────────────────────────────
 * 【変更後の手順】
 * ────────────────────────────────────────────────────────────
 * 1. dicts / シナリオを直す
 * 2. 必要ならシード（mulberry32 の引数）を少し進めて中身を刷新
 *    ※生成順は 欧文普通語→暗語→和文。和文だけ直すならシードを触らなければ欧文・暗語は不変
 * 3. SETS_VERSION を上げる（配信シャードのキャッシュ対策）
 * 4. npm run generate:exam-sets（シャード分割まで行う）
 * 5. 和文はサンプル数通を目で読んでカタカナ破綻がないか確認
 * 6. npm test（stored set 件数など）
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJaScenarios } from "./exam/jaScenarios.mjs";
import { writeExamShards } from "./splitExamSets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
/** @see ファイル先頭の dicts.json 書き方ルール */
const dicts = JSON.parse(
  readFileSync(join(root, "data/exam/dicts.json"), "utf8"),
);

const COUNT = 1000;
/** 中身を変えたら上げる。配信シャードの URL（/exam/sets/v{n}/）に入り、古いキャッシュと混ざらない */
const SETS_VERSION = 2;
/** 和文額表1枚あたりの本文マス数（変更するなら pagesToChars も見直す） */
const PAGE = 60;

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const rng = mulberry32(20261004 + 59); // カタカナ誤変換修正でシード更新
const pick = (pool) => pool[Math.floor(rng() * pool.length)];
const pad2 = (n) => String(n).padStart(2, "0");
const compactLen = (text) => text.replace(/\s+/g, "").length;

const wordCount = (text) =>
  text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;

const normalizeSpaces = (text) => text.trim().replace(/\s+/g, " ");

// ── 欧文本文 ───────────────────────────────────────────
// ルール: 大文字・無句点・自然文（羅列禁止）。IT IS / AT THE / THESE 等を意識。
// 詳細はファイル先頭コメント。
const EN_PORTS = [
  "YOKOHAMA",
  "KOBE",
  "NAGASAKI",
  "HAKODATE",
  "SINGAPORE",
  "MANILA",
  "HONGKONG",
  "VANCOUVER",
  "MARSEILLE",
  "SEATTLE",
];
const EN_BERTHS = ["TWO", "THREE", "FIVE", "SEVEN", "NINE"];
const EN_CARGOES = [
  "GENERAL CARGO",
  "STEEL COILS",
  "TIMBER",
  "MACHINERY",
  "BAGGED RICE",
  "COTTON",
  "FROZEN FISH",
  "MOTOR PARTS",
];
const EN_WINDS = ["NORTHEAST", "NORTHWEST", "SOUTHWEST", "EASTERLY"];
const EN_TIMES = [
  "0430",
  "0615",
  "0745",
  "0830",
  "1015",
  "1230",
  "1445",
  "1630",
  "1815",
  "2130",
];
const EN_CLOSINGS = [
  "PLEASE ACKNOWLEDGE RECEIPT",
  "PLEASE CONFIRM THESE ARRANGEMENTS",
  "WE SHALL REPORT AGAIN TOMORROW",
  "YOUR EARLY REPLY WILL BE APPRECIATED",
  "PLEASE ADVISE WITHOUT DELAY",
];
const usedEnBodies = new Set();

const EN_SCENARIOS = [
  () => {
    const port = pick(EN_PORTS);
    const time = pick(EN_TIMES);
    const berth = pick(EN_BERTHS);
    return `${pick([
      `WE EXPECT TO REACH ${port} AT ${time} TOMORROW AND WILL WAIT OUTSIDE THE BREAKWATER UNTIL THE PILOT BOARDS`,
      `OUR VESSEL WILL ARRIVE OFF ${port} AT ${time} TOMORROW AND WILL REMAIN AT THE PILOT STATION FOR ORDERS`,
      `IT IS NOW EXPECTED THAT WE SHALL REACH ${port} AT ${time} TOMORROW WITH NO FURTHER DELAY`,
    ])} ${pick([
      "THE FORWARD DRAFT IS EIGHT METERS AND THE STARBOARD PILOT LADDER WILL BE READY",
      "THE ENGINES ARE READY FOR MANEUVERING AND BOTH ANCHORS HAVE BEEN CLEARED",
      "ALL ARRIVAL PAPERS ARE COMPLETE AND THE MASTER WILL REPORT ON CHANNEL SIXTEEN",
    ])} ${pick([
      `PLEASE CONFIRM THAT BERTH NUMBER ${berth} AND TWO TUGS WILL BE READY AT THE ENTRANCE`,
      `THE MASTER REQUESTS THAT THE PORT AGENT CONFIRM OUR ASSIGNED BERTH BEFORE ${time}`,
      "IT IS IMPORTANT THAT THE PILOT OFFICE ADVISE WHETHER A TUG WILL BE REQUIRED",
    ])}`;
  },
  () => {
    const port = pick(EN_PORTS);
    const wind = pick(EN_WINDS);
    const delay = pick(["TWO", "THREE", "FOUR", "SIX"]);
    return `${pick([
      `A STRONG ${wind} WIND HAS REDUCED VISIBILITY NEAR THE CAPE AND THE SEA IS BECOMING ROUGH`,
      `THERE IS DENSE FOG ALONG THE COAST AND A STRONG ${wind} WIND IS RAISING A HEAVY SEA`,
      `WEATHER CONDITIONS HAVE DETERIORATED SINCE MIDNIGHT WITH ${wind} WINDS AND FREQUENT RAIN SQUALLS`,
    ])} ${pick([
      `WE HAVE REDUCED SPEED TO EIGHT KNOTS AND MAY ARRIVE ${delay} HOURS LATE`,
      `THE MASTER HAS ALTERED COURSE TO THE SOUTH AND EXPECTS A DELAY OF ${delay} HOURS`,
      `WE SHALL REMAIN CLEAR OF THE COAST UNTIL VISIBILITY IMPROVES AFTER DAYBREAK`,
    ])} ${pick([
      `PLEASE CONFIRM THAT SHELTER IS AVAILABLE AT ${port} IF CONDITIONS CONTINUE TO WORSEN`,
      `IT IS IMPORTANT THAT THE PILOT AT ${port} RECEIVE THE LATEST FORECAST AND NOTICE OF OUR DELAY`,
      "THE MASTER REQUESTS THAT THE BERTH REMAIN AVAILABLE UNTIL THE WEATHER IMPROVES",
    ])}`;
  },
  () => {
    const time = pick(EN_TIMES);
    const speed = pick(["FIVE", "SIX", "SEVEN", "EIGHT"]);
    return `${pick([
      "THE STARBOARD MAIN ENGINE DEVELOPED A COOLING WATER LEAK DURING THE MORNING WATCH",
      "THERE IS A FAULT IN THE FUEL PUMP OF THE PORT ENGINE AND REPAIRS ARE IN PROGRESS",
      "THE STEERING MOTOR OVERHEATED SHORTLY AFTER MIDNIGHT AND THE RESERVE UNIT IS NOW IN USE",
    ])} ${pick([
      `WE ARE PROCEEDING AT ${speed} KNOTS AND EXPECT THE REPAIR TO BE COMPLETED BY ${time}`,
      `SPEED HAS BEEN REDUCED TO ${speed} KNOTS WHILE THE ENGINEERS REPLACE THE DAMAGED PART`,
      `THE VESSEL IS STEERING SAFELY BUT ARRIVAL WILL BE DELAYED UNTIL ABOUT ${time}`,
    ])} ${pick([
      "PLEASE CONFIRM THAT A SERVICE ENGINEER AND THE REQUIRED SPARE PARTS WILL BE READY ON ARRIVAL",
      "THE MASTER REQUESTS THAT THE AGENT NOTE OUR DELAY AND ARRANGE AN INSPECTION AFTER BERTHING",
      "PLEASE CONFIRM THAT REPAIRS CAN BE MADE AT THE ANCHORAGE BEFORE WE ENTER",
    ])}`;
  },
  () => {
    const cargo = pick(EN_CARGOES);
    const berth = pick(EN_BERTHS);
    const time = pick(EN_TIMES);
    return `${pick([
      `LOADING OF ${cargo} AT BERTH NUMBER ${berth} IS PROCEEDING MORE SLOWLY THAN EXPECTED`,
      `DISCHARGE OF ${cargo} AT BERTH NUMBER ${berth} WAS STOPPED FOR TWO HOURS BY HEAVY RAIN`,
      `THE LAST CONSIGNMENT OF ${cargo} REACHED THE WHARF LATE AND WORK HAS ONLY JUST RESUMED`,
    ])} ${pick([
      `THE FOREMAN NOW EXPECTS ALL HATCHES TO BE FINISHED BY ${time} IF THE PRESENT RATE CONTINUES`,
      `TWO ADDITIONAL GANGS ARE WORKING AND COMPLETION IS NOW EXPECTED AT ${time}`,
      `THE SHORE CRANE IS AGAIN IN SERVICE AND THE FINAL HOLD SHOULD BE CLEAR BY ${time}`,
    ])} ${pick([
      "PLEASE CONFIRM THAT THE FINAL SURVEY AND CARGO PAPERS WILL BE READY FOR THE MASTER",
      "IT IS IMPORTANT THAT THE PILOT AND TUG COMPANY RECEIVE THE NEW SAILING TIME",
      "THE MASTER REQUESTS THAT CUSTOMS RECEIVE THE COMPLETED MANIFEST BEFORE DEPARTURE",
    ])}`;
  },
  () => {
    const port = pick(EN_PORTS);
    const age = pick(["NINETEEN", "TWENTY FOUR", "THIRTY TWO", "FORTY FIVE", "FIFTY"]);
    const cases = [
      [
        `A CREW MEMBER AGED ${age} HAS HAD A HIGH FEVER AND SEVERE STOMACH PAIN SINCE LAST NIGHT`,
        "HE IS CONSCIOUS AND BREATHING NORMALLY BUT THE MEDICINE ON BOARD HAS GIVEN LITTLE RELIEF",
        `PLEASE CONFIRM THAT A DOCTOR WILL MEET THE VESSEL AT ${port} AND ADVISE THE NEAREST SAFE BERTH`,
      ],
      [
        `THE SECOND ENGINEER AGED ${age} INJURED HIS LEFT ARM WHILE WORKING IN THE ENGINE ROOM`,
        "THE BLEEDING HAS STOPPED AND HIS CONDITION IS STABLE BUT HE REQUIRES A MEDICAL EXAMINATION",
        `IT IS IMPORTANT THAT AN AMBULANCE BE READY AT ${port} WHEN THE PATIENT IS LANDED`,
      ],
      [
        `A PASSENGER AGED ${age} BECAME ILL THIS MORNING AND IS NOW RESTING IN THE SHIP HOSPITAL`,
        "THE PATIENT IS COMFORTABLE AT PRESENT AND THE RADIO MEDICAL INSTRUCTIONS ARE BEING FOLLOWED",
        `THE MASTER REQUESTS THAT THE HEALTH OFFICER AT ${port} SEND FURTHER MEDICAL ADVICE`,
      ],
    ];
    return pick(cases).join(" ");
  },
  () => {
    const port = pick(EN_PORTS);
    const time = pick(EN_TIMES);
    return `${pick([
      `OUR FRESH WATER AND DIESEL OIL WILL BE BELOW THE REQUIRED RESERVE WHEN WE REACH ${port}`,
      `THE VESSEL REQUIRES FRESH WATER LUBRICATING OIL AND PROVISIONS AT ${port} BEFORE DEPARTURE`,
      `SEVERAL DECK STORES ORDERED LAST WEEK HAVE NOT YET BEEN DELIVERED TO THE VESSEL AT ${port}`,
    ])} ${pick([
      `WE CAN RECEIVE THE SUPPLIES FROM ${time} AND THE STARBOARD BUNKER CONNECTION WILL BE READY`,
      `THE CHIEF ENGINEER WILL CHECK THE QUANTITIES AND CAN BEGIN TAKING BUNKERS AT ${time}`,
      `A COMPLETE LIST HAS BEEN SENT TO THE AGENT AND THE CREW CAN RECEIVE STORES AFTER ${time}`,
    ])} ${pick([
      "PLEASE CONFIRM THAT THE REQUIRED QUANTITIES ARE AVAILABLE AND STATE WHEN THE SUPPLY BOAT WILL ARRIVE",
      "IT IS IMPORTANT THAT THE CHANDLER CHECK EACH ITEM AND DELIVER THE ORDER WITHOUT SUBSTITUTIONS",
      "THE MASTER REQUESTS THAT THE AGENT CONFIRM THE TOTAL COST AND DELIVERY TIME",
    ])}`;
  },
  () => {
    const port = pick(EN_PORTS);
    return `${pick([
      "THE ORIGINAL CARGO MANIFEST CONTAINS TWO INCORRECT PACKAGE NUMBERS AND MUST BE REPLACED BEFORE CLEARANCE",
      "THE CREW LIST SENT YESTERDAY DOES NOT INCLUDE THE NEW RADIO OFFICER WHO JOINED AT THE LAST PORT",
      "THE HEALTH CERTIFICATE AND THREE CUSTOMS FORMS ARE COMPLETE BUT THE AGENT HAS NOT RETURNED THE SIGNED COPIES",
    ])} ${pick([
      `THE MASTER HAS PREPARED THE CORRECT DETAILS AND WILL SEND THEM TO THE OFFICE AT ${port}`,
      `REVISED COPIES ARE READY ON BOARD AND MAY BE COLLECTED BY THE AGENT AT ${port}`,
      `ALL OTHER ARRIVAL DOCUMENTS HAVE BEEN CHECKED AND ARE READY FOR INSPECTION AT ${port}`,
    ])} ${pick([
      "PLEASE FILE THE CORRECTION WITH CUSTOMS AND CONFIRM THAT DEPARTURE WILL NOT BE DELAYED",
      "IT IS IMPORTANT THAT THE REQUIRED COPIES BE STAMPED AND RETURNED BEFORE SAILING",
      "THE MASTER REQUESTS THAT THE PORT AUTHORITIES ADVISE WHETHER ANY FURTHER DECLARATION IS REQUIRED",
    ])}`;
  },
  () => {
    const port = pick(EN_PORTS);
    const distance = pick(["THREE", "FOUR", "FIVE", "SIX"]);
    return `${pick([
      `THE LIGHT ON THE EASTERN BUOY WAS NOT VISIBLE AND THE BUOY APPEARS TO BE ${distance} CABLES OUT OF POSITION`,
      `A LARGE UNLIT OBJECT WAS SIGHTED ${distance} MILES SOUTH OF THE MAIN SHIPPING ROUTE BEFORE DAWN`,
      `FLOATING TIMBER EXTENDS FOR ABOUT ${distance} MILES ACROSS THE APPROACH TO THE NORTHERN CHANNEL`,
    ])} ${pick([
      "WE HAVE MARKED THE POSITION ON THE CHART AND PASSED WELL CLEAR AT REDUCED SPEED",
      "THE BRIDGE HAS WARNED TWO FOLLOWING VESSELS AND IS MAINTAINING A CAREFUL LOOKOUT",
      "OUR POSITION AND TIME OF SIGHTING HAVE BEEN ENTERED IN THE LOG FOR REFERENCE",
    ])} ${pick([
      `IT IS IMPORTANT THAT THE COAST STATION AT ${port} WARN ALL SHIPPING BY RADIO`,
      `PLEASE CONFIRM THAT THE LIGHTHOUSE AUTHORITY AT ${port} WILL INSPECT THE AREA`,
      "THE MASTER REQUESTS THAT A NAVIGATION WARNING BE ISSUED WITHOUT DELAY",
    ])}`;
  },
  () => {
    const time = pick(EN_TIMES);
    const port = pick(EN_PORTS);
    return `${pick([
      "RADIO CONTACT WITH THE AGENT HAS BEEN UNRELIABLE SINCE YESTERDAY BECAUSE OF HEAVY INTERFERENCE",
      "WE RECEIVED ONLY PART OF YOUR LAST MESSAGE AND THE FIGURES IN THE SECOND LINE ARE NOT CLEAR",
      "THE MAIN TRANSMITTER IS UNDER REPAIR AND COMMUNICATION IS BEING MAINTAINED ON THE RESERVE SET",
    ])} ${pick([
      `WE SHALL KEEP WATCH ON THE WORKING FREQUENCY FROM ${time} AND CALL THE COAST STATION EVERY HOUR`,
      `THE RADIO OFFICER WILL LISTEN AGAIN AT ${time} AND RECORD THE MESSAGE AT SLOW SPEED`,
      `A TEST SIGNAL WILL BE SENT AT ${time} WHEN THE VESSEL IS CLEAR OF THE HIGH LAND NEAR ${port}`,
    ])} ${pick([
      "THE RADIO OFFICER REQUESTS THAT THE COMPLETE MESSAGE AND EACH IMPORTANT NUMBER BE REPEATED",
      "PLEASE HOLD ALL NONURGENT TRAFFIC UNTIL WE CONFIRM THAT THE REPAIR IS COMPLETE",
      "IT IS IMPORTANT THAT THE COAST STATION CALL US AT THE AGREED TIME AND FREQUENCY",
    ])}`;
  },
  () => {
    const port = pick(EN_PORTS);
    const number = pick(["TWO", "THREE", "FOUR", "FIVE"]);
    const cases = [
      [
        `${number} RELIEF CREW MEMBERS ARE DUE TO JOIN THE VESSEL AT ${port} BEFORE THE NEXT VOYAGE`,
        "THEIR PASSPORT DETAILS HAVE BEEN CHECKED BUT TRANSPORT FROM THE AIRPORT IS NOT YET CONFIRMED",
        "THE MASTER REQUESTS THAT TRANSPORT BE ARRANGED AND THEIR EXPECTED ARRIVAL TIME BE CONFIRMED",
      ],
      [
        `${number} MEMBERS OF THE DECK CREW WILL LEAVE THE VESSEL AT ${port} AFTER COMPLETING THEIR CONTRACTS`,
        "THEIR COMPANY LETTERS AND TRAVEL DOCUMENTS ARE READY IN THE OFFICE OF THE MASTER",
        "IT IS IMPORTANT THAT IMMIGRATION FORMALITIES AND TRANSPORT TO THE AIRPORT BE ARRANGED",
      ],
      [
        `THE MASTER HAS APPROVED A CHANGE OF ${number} CREW MEMBERS DURING THE CALL AT ${port}`,
        "THE FINAL CREW LIST AND ALL MEDICAL CERTIFICATES WERE SENT TO THE AGENT YESTERDAY",
        "PLEASE CONFIRM THAT IMMIGRATION WILL ATTEND THE VESSEL IMMEDIATELY AFTER BERTHING",
      ],
    ];
    return pick(cases).join(" ");
  },
  () => {
    const port = pick(EN_PORTS);
    const time = pick(EN_TIMES);
    const cases = [
      [
        "A SMALL FISHING BOAT WITHOUT LIGHTS WAS FOUND DRIFTING NEAR OUR COURSE DURING THE NIGHT",
        "WE HAVE TAKEN THE OCCUPANTS ON BOARD AND THEY ARE SAFE WITH NO SERIOUS INJURIES",
        `THE MASTER REQUESTS THAT THE AUTHORITIES AT ${port} ADVISE WHERE WE SHOULD LAND THE SURVIVORS`,
      ],
      [
        "WE RECEIVED A DISTRESS CALL FROM A YACHT WHICH HAD LOST ITS MAST IN HEAVY WEATHER",
        "OUR RESCUE BOAT HAS PASSED A TOWING LINE AND BOTH VESSELS ARE NOW PROCEEDING SLOWLY",
        `PLEASE INFORM THE AUTHORITIES AT ${port} THAT WE EXPECT TO ARRIVE WITH THE TOW AT ${time}`,
      ],
      [
        "A COASTAL VESSEL REPORTED FLOODING IN THE ENGINE ROOM AND REQUESTED IMMEDIATE ASSISTANCE",
        "WE ARE STANDING BY THE VESSEL AND THE FLOODING IS BEING CONTROLLED WITH A PORTABLE PUMP",
        `IT IS IMPORTANT THAT A RESCUE VESSEL COME FROM ${port} AND OTHER SHIPPING KEEP CLEAR`,
      ],
    ];
    return pick(cases).join(" ");
  },
  () => {
    const firstPort = pick(EN_PORTS);
    let secondPort = pick(EN_PORTS);
    while (secondPort === firstPort) secondPort = pick(EN_PORTS);
    return `${pick([
      `THE OWNERS HAVE INSTRUCTED US TO CALL AT ${firstPort} BEFORE PROCEEDING TO ${secondPort}`,
      `OUR NEXT VOYAGE HAS BEEN CHANGED AND THE VESSEL WILL NOW SAIL FROM ${firstPort} DIRECT TO ${secondPort}`,
      `THE CHARTERERS REQUEST THAT PART OF THE CARGO BE DISCHARGED AT ${firstPort} BEFORE WE CONTINUE TO ${secondPort}`,
    ])} ${pick([
      "THE MASTER CAN ACCEPT THE NEW ORDERS PROVIDED THAT THE REQUIRED CHARTS AND BUNKERS ARE SUPPLIED",
      "THE REVISED ROUTE ADDS TWO DAYS TO THE PASSAGE BUT WEATHER CONDITIONS ARE EXPECTED TO REMAIN FAVORABLE",
      "THE CARGO PLAN CAN BE ALTERED WITHOUT DELAY IF THE FINAL INSTRUCTIONS ARRIVE BEFORE LOADING IS COMPLETED",
    ])} ${pick([
      "PLEASE CONFIRM THAT THE VOYAGE ORDERS AND NEW AGENCY DETAILS ARE FINAL",
      "IT IS IMPORTANT THAT THE CONSIGNEES KNOW WHICH PORT WILL ISSUE THE OUTWARD CLEARANCE",
      "PLEASE SEND THE FINAL CARGO INSTRUCTIONS AND CONFIRM THAT THE EXTRA EXPENSE IS APPROVED",
    ])}`;
  },
];
const enScenarioUseCounts = Array.from({ length: EN_SCENARIOS.length }, () => 0);

/** 完結した文節だけを使い、目標語数に最も近い未使用本文を返す。 */
const composeEnBody = (targetWords) => {
  const scenarioOrder = EN_SCENARIOS.map((_, index) => ({ index, tie: rng() }))
    .sort(
      (left, right) =>
        enScenarioUseCounts[left.index] - enScenarioUseCounts[right.index] ||
        left.tie - right.tie,
    );

  for (const { index } of scenarioOrder) {
    let best;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const base = normalizeSpaces(EN_SCENARIOS[index]());
      const variants = [base, ...EN_CLOSINGS.map((closing) => `${base} ${closing}`)];
      for (const candidate of variants) {
        const words = wordCount(candidate);
        if (words < 32 || words > 48 || usedEnBodies.has(candidate)) continue;
        if (!/\b(IT IS|THERE IS|AT THE|THESE|THAT)\b/.test(candidate)) continue;
        const score = Math.abs(words - targetWords);
        if (!best || score < best.score) best = { candidate, score };
        if (score <= 1) break;
      }
      if (best?.score <= 1) break;
    }
    if (!best) continue;
    enScenarioUseCounts[index] += 1;
    usedEnBodies.add(best.candidate);
    return best.candidate;
  }

  throw new Error("unable to compose a unique English body");
};

const originEn = () => {
  if (rng() < 0.45) return pick(dicts.originsLand);
  const ship = pick(dicts.shipsEn);
  return `${ship.name}/${ship.call}`;
};

const addressEn = () => {
  const roll = rng();
  if (roll < 0.4) {
    const ship = pick(dicts.shipsEn);
    const person = pick([
      "CAPTAIN",
      "CAPT OKADA",
      "YAMAMOTO",
      "YOSHIKAWA",
      "KOJIMA",
      "SUGIMOTO",
    ]);
    const via = pick(dicts.coastVia);
    return `${person} ${ship.name}/${ship.call} ${via}`;
  }
  if (roll < 0.7)
    return `${pick(dicts.personsEn)} CARE ${pick(dicts.placesEn)}`;
  if (roll < 0.85) return `${pick(dicts.personsEn)} ${pick(dicts.placesEn)}`;
  return `${pick(dicts.firmsEn)} ${pick(["TOKYO", "SHANGHAI", "MARSEILLE", "KUMAMOTO", "KOBE"])}`;
};

const addressEnCodes = () => {
  if (rng() < 0.75)
    return `${pick(dicts.firmsEn)} ${pick(["TOKYO", "SHANGHAI", "MARSEILLE", "KUMAMOTO"])}`;
  return addressEn();
};

const filingTime = () =>
  `${pad2(Math.floor(rng() * 24))}${pad2(Math.floor(rng() * 60))}`;
const filingDate = () =>
  rng() < 0.65 ? String(1 + Math.floor(rng() * 28)) : undefined;

// ── 和文本文 ───────────────────────────────────────────
// ルール: カタカナのみ（ひらがな・漢字・英字・空白・読点なし）。
// 「困ってる」=コマツテイル。「切符」=キップ。「運動会」=ウンドウカイ。
// ローマ字変換の生出力をそのまま貼らない。詳細はファイル先頭コメント。

const JA_CLOSING = [
  "ヤマダ",
  "サトウ",
  "タナカ",
  "センチヨウ",
  "ハナコ",
  "タロウ",
  "カアサン",
  "トウサン",
  "オジサン",
  "イトコ",
  "スズキ",
  "タカハシ",
  "イトウ",
  "ワタナベ",
  "オバアチヤン",
  "アニキ",
  "イモウト",
  "キヨウダイ",
];

const JA_DATES = ["ミツカ", "ヨウカ", "トオカ", "ジユウゴニチ", "ニジユウニチ"];
const JA_TIMES = ["ゴゼンハチジ", "ゴゼンクジハン", "ゴゴイチジ", "ゴゴサンジ", "ユウガタロクジ"];
const usedJaBodies = new Set();
const pickOrderedSubset = (items, count) => {
  const selected = [];
  let needed = count;
  for (let index = 0; index < items.length && needed > 0; index += 1) {
    const remaining = items.length - index;
    if (rng() < needed / remaining) {
      selected.push(items[index]);
      needed -= 1;
    }
  }
  return selected;
};

/** 数字入りの通の割合。数字は和文の数字符号（フル）で送り、額表には漢数字で印字 */
const JA_NUMERIC_RATE = 0.1;
/** 本題と結びの間を段落「」」で区切る通の割合 */
const JA_PARAGRAPH_RATE = 0.1;
let jaNumericMode = false;
/** シナリオ内の数量。数字入りの通だけ算用数字、それ以外はカナ */
const num = (digits, kana) => (jaNumericMode ? digits : kana);

// 一通の中では同じ話題を保ち、導入から結論まで順に並べる。ネタは scripts/exam/jaScenarios.mjs
const JA_SCENARIOS = createJaScenarios({ pick, rng, dicts, dates: JA_DATES, times: JA_TIMES, num });
const jaScenarioUseCounts = Array.from({ length: JA_SCENARIOS.length }, () => 0);

/**
 * 文節を切らず、ページ数を守りながら目標字数に最も近い本文を作る。
 * 話題は使用回数の少ない順に試し、同じセットの別の通と同じ話題は避ける。
 * 数字入りの通は数字を含む候補だけ採り、数字を出せない話題は飛ばす。
 */
const composeJaBody = (targetChars, avoidScenario = -1) => {
  const threePages = targetChars > 120;
  const minChars = threePages ? 121 : 61;
  const maxChars = threePages ? 180 : 120;
  jaNumericMode = rng() < JA_NUMERIC_RATE;
  const closingSeparator = rng() < JA_PARAGRAPH_RATE ? "」" : "、";
  const scenarioOrder = JA_SCENARIOS.map((_, index) => ({ index, tie: rng() }))
    .filter(({ index }) => index !== avoidScenario)
    .sort(
      (left, right) =>
        jaScenarioUseCounts[left.index] - jaScenarioUseCounts[right.index] ||
        left.tie - right.tie,
    );

  for (const { index } of scenarioOrder) {
    let best;
    for (let attempt = 0; attempt < 120 && !(best?.score <= 3); attempt += 1) {
      const story = JA_SCENARIOS[index]();
      const ending = pick(story.endings);
      const signature = pick(story.signatures ?? JA_CLOSING);
      for (let detailCount = 2; detailCount <= story.details.length; detailCount += 1) {
        const candidate = [
          [story.opening, ...pickOrderedSubset(story.details, detailCount)].join("、"),
          [ending, signature].join("、"),
        ].join(closingSeparator);
        const chars = compactLen(candidate);
        if (chars < minChars || chars > maxChars || usedJaBodies.has(candidate)) continue;
        if (jaNumericMode && !/[0-9]/.test(candidate)) continue;
        const score = Math.abs(chars - targetChars);
        if (!best || score < best.score) best = { candidate, score };
        if (score <= 3) break;
      }
    }
    if (!best) continue;
    jaScenarioUseCounts[index] += 1;
    usedJaBodies.add(best.candidate);
    return { body: best.candidate, scenario: index };
  }

  throw new Error("unable to compose a unique Japanese body");
};

const addressJa = () => {
  const station = pick(dicts.coastJa);
  const roll = rng();
  if (roll < 0.5)
    return `${station}」${pick(dicts.shipsJa)}」${pick(dicts.personsJa)}`;
  if (roll < 0.8)
    return `${station}」${pick(dicts.placesJa)}」${pick(dicts.personsJa)}`;
  return `${pick(dicts.personsJa)}」${pick(dicts.placesJa)}`;
};

const pagesToChars = (pages) => {
  if (pages <= 1) return 40 + Math.floor(rng() * 21);
  const lastMin = pages >= 3 ? 15 : 20;
  const lastMax = 40;
  const last = lastMin + Math.floor(rng() * (lastMax - lastMin + 1));
  return (pages - 1) * PAGE + last;
};

const randomCodeGroup = () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let prev = "";
  let out = "";
  for (let i = 0; i < 5; i += 1) {
    let ch = alphabet[Math.floor(rng() * alphabet.length)];
    while (ch === prev) ch = alphabet[Math.floor(rng() * alphabet.length)];
    out += ch;
    prev = ch;
  }
  return out;
};

const formatCodeBody = () => {
  const groups = Array.from({ length: 40 }, () => randomCodeGroup());
  const lines = [];
  for (let i = 0; i < groups.length; i += 8)
    lines.push(groups.slice(i, i + 8).join(" "));
  return lines.join("\n");
};

const INTERNATIONAL_MORSE = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..",
  J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
  S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....",
  6: "-....", 7: "--...", 8: "---..", 9: "----.",
  "/": "-..-.", "=": "-...-", "+": ".-.-.",
};
const PLAIN_WPM = 23;
const PLAIN_MAX_SECONDS = 310;

const morseDurationSec = (text, wpm = PLAIN_WPM) => {
  const tokens = [];
  for (const char of text.toUpperCase()) {
    if (/\s/.test(char)) {
      if (tokens.at(-1) !== " ") tokens.push(" ");
    } else if (INTERNATIONAL_MORSE[char]) {
      tokens.push(char);
    }
  }
  let units = 0;
  tokens.forEach((symbol, index) => {
    if (symbol === " ") {
      units += 4; // 7単位の語間隔から直前の3単位文字間隔を引いた分
      return;
    }
    const code = INTERNATIONAL_MORSE[symbol];
    units += Array.from(code).reduce((sum, element) => sum + (element === "-" ? 3 : 1), 0);
    units += Math.max(0, code.length - 1);
    if (index < tokens.length - 1) units += 3;
  });
  return units * (1.2 / wpm);
};

const tariffWordCount = (address, body, signature) => {
  const words = [address, body, signature ?? ""]
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const tariff = words.reduce(
    (sum, word) => sum + Math.max(1, Math.ceil(word.length / 10)),
    0,
  );
  return tariff > words.length ? `${tariff}/${words.length}` : String(words.length);
};

const plainTelegramPlayText = (telegram, index) => {
  const preamble = [
    index === 0 ? "HRHR" : "",
    "NR",
    telegram.number,
    telegram.office,
    tariffWordCount(telegram.address, telegram.body, telegram.signature),
    telegram.date,
    telegram.receivedAt,
  ].filter(Boolean).join(" ");
  const signature = telegram.signature ? ` =${telegram.signature}` : "";
  const end = index === 0 ? " +" : "";
  return `${preamble} = ${telegram.address} = ${telegram.body}${signature}${end}`;
};

const plainSetDurationSec = (telegrams) =>
  telegrams.reduce(
    (sum, telegram, index) => sum + morseDurationSec(plainTelegramPlayText(telegram, index)),
    5, // 2通の通間休止
  );

const makePlainSet = (index) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    // 通あたり ~35–39語。語数だけでなく実際のモールス送信時間も確認する。
    const targetWords = 35 + Math.floor(rng() * 5);
    const makeTelegram = (target) => ({
      number: String(1 + Math.floor(rng() * 80)),
      office: originEn(),
      address: addressEn(),
      body: composeEnBody(target),
      receivedAt: filingTime(),
      date: filingDate(),
      signature: rng() < 0.55 ? pick(dicts.signatures) : undefined,
    });
    const telegrams = [
      makeTelegram(targetWords),
      makeTelegram(targetWords + (rng() < 0.5 ? -1 : 1)),
    ];
    if (plainSetDurationSec(telegrams) <= PLAIN_MAX_SECONDS) {
      return {
        id: `plain-${String(index + 1).padStart(4, "0")}`,
        subjectId: "plain",
        telegrams,
      };
    }
  }
  throw new Error(`unable to fit plain set ${index + 1} within time limit`);
};

const makeCodesSet = (index) => {
  const t1 = {
    number: String(1 + Math.floor(rng() * 80)),
    office: originEn(),
    address: addressEnCodes(),
    body: formatCodeBody(),
    receivedAt: filingTime(),
    date: filingDate(),
  };
  const t2 = {
    number: String(1 + Math.floor(rng() * 80)),
    office: originEn(),
    address: addressEnCodes(),
    body: formatCodeBody(),
    receivedAt: filingTime(),
    date: filingDate(),
  };
  return {
    id: `codes-${String(index + 1).padStart(4, "0")}`,
    subjectId: "codes",
    telegrams: [t1, t2],
  };
};

const makeWabunSet = (index) => {
  const firstPages = rng() < 0.5 ? 2 : 3;
  const secondPages = 5 - firstPages;
  let previousScenario = -1;
  const mk = (pages) => {
    const officeNumeric = rng() < 0.45;
    const number = String(1 + Math.floor(rng() * 80));
    const office = officeNumeric
      ? String(1 + Math.floor(rng() * 80))
      : pick(dicts.coastJa);
    const hour = Math.floor(rng() * 24);
    const minute = Math.floor(rng() * 60);
    const address = addressJa();
    const { body, scenario } = composeJaBody(pagesToChars(pages), previousScenario);
    previousScenario = scenario;
    return { office, officeNumeric, number, hour, minute, address, body, pages };
  };
  return {
    id: `wabun-${String(index + 1).padStart(4, "0")}`,
    subjectId: "wabun",
    telegrams: [mk(firstPages), mk(secondPages)],
  };
};

const outDir = join(root, "data/exam");
mkdirSync(outDir, { recursive: true });

const plain = Array.from({ length: COUNT }, (_, i) => makePlainSet(i));
const codes = Array.from({ length: COUNT }, (_, i) => makeCodesSet(i));
const wabun = Array.from({ length: COUNT }, (_, i) => makeWabunSet(i));

const assertValid = (condition, message) => {
  if (!condition) throw new Error(`exam set validation failed: ${message}`);
};

const validateDicts = () => {
  const asciiPools = [
    dicts.originsLand,
    dicts.coastVia,
    dicts.personsEn,
    dicts.placesEn,
    dicts.firmsEn,
    dicts.signatures,
  ];
  for (const pool of asciiPools) {
    assertValid(pool.every((item) => /^[A-Z0-9 /]+$/.test(item)), "invalid English dictionary entry");
  }
  assertValid(
    dicts.shipsEn.every(
      (ship) => /^[A-Z0-9]+$/.test(ship.name) && /^[A-Z]{4}$/.test(ship.call),
    ),
    "invalid English ship or call sign",
  );
  const kanaPools = [dicts.coastJa, dicts.shipsJa, dicts.personsJa, dicts.placesJa];
  for (const pool of kanaPools) {
    assertValid(pool.every((item) => /^[ァ-ヶー]+$/.test(item)), "invalid Japanese dictionary entry");
  }
};

/** 電信の慣例で拗音・促音は大書き。本文に小書きが混ざったら作文ミス */
const JA_SMALL_KANA = /[ァィゥェォッャュョヮ]/;
/** 括弧入りの本文がこの割合を下回ったらネタ側の括弧が足りない */
const JA_MIN_BRACKET_SHARE = 0.5;
/** 同じ書き出しがこの割合を超えたら先が読める */
const JA_MAX_OPENING_SHARE = 0.02;

const jaOpeningCounts = (bodies) => {
  const counts = new Map();
  for (const body of bodies) {
    const opening = body.split("、")[0];
    counts.set(opening, (counts.get(opening) ?? 0) + 1);
  }
  return counts;
};

/** （ ）は対で入れ子なし、中身は2〜16字のカナ。文頭・文節頭・括弧の連続は不可 */
const validateJaBrackets = (body) => {
  const pairs = [...body.matchAll(/（([^（）]*)）/g)];
  const stripped = body.replace(/（[^（）]*）/g, "");
  assertValid(!/[（）]/.test(stripped), `unbalanced or nested brackets: ${body}`);
  for (const [, inner] of pairs) {
    assertValid(/^[ァ-ヶー]{2,16}$/.test(inner), `invalid bracket content: ${inner}`);
  }
  assertValid(!/(^（|、（|）（)/.test(body), `misplaced bracket: ${body}`);
};

const validateGeneratedData = () => {
  validateDicts();
  assertValid(plain.length === COUNT, "plain set count");
  assertValid(codes.length === COUNT, "codes set count");
  assertValid(wabun.length === COUNT, "wabun set count");

  const plainBodies = plain.flatMap((set) => set.telegrams.map((telegram) => telegram.body));
  assertValid(new Set(plainBodies).size === plainBodies.length, "duplicate English body");
  for (const body of plainBodies) {
    assertValid(/^[A-Z0-9 ]+$/.test(body), `invalid English body: ${body}`);
    const words = wordCount(body);
    assertValid(words >= 32 && words <= 48, `English word count ${words}`);
    assertValid(!/\s{2,}/.test(body), "repeated spaces in English body");
    assertValid(/\b(IT IS|THERE IS|AT THE|THESE|THAT)\b/.test(body), "missing English practice pattern");
  }
  for (const set of plain) {
    const seconds = plainSetDurationSec(set.telegrams);
    assertValid(seconds <= PLAIN_MAX_SECONDS, `plain duration ${seconds.toFixed(2)} seconds`);
  }

  for (const set of codes) {
    for (const telegram of set.telegrams) {
      const groups = telegram.body.trim().split(/\s+/);
      assertValid(groups.length === 40, "code body group count");
      assertValid(groups.every((group) => /^[A-Z0-9]{5}$/.test(group)), "invalid code group");
    }
  }

  const wabunBodies = wabun.flatMap((set) => set.telegrams.map((telegram) => telegram.body));
  assertValid(new Set(wabunBodies).size === wabunBodies.length, "duplicate Japanese body");
  for (const set of wabun) {
    assertValid(set.telegrams.reduce((sum, telegram) => sum + telegram.pages, 0) === 5, "wabun page total");
    for (const telegram of set.telegrams) {
      const { body } = telegram;
      assertValid(/^[ァ-ヶー、（）」0-9]+$/.test(body), `invalid Japanese body: ${body}`);
      assertValid(!JA_SMALL_KANA.test(body), `small kana in Japanese body: ${body}`);
      assertValid(!/(^[、」]|[、」]{2}|[、」]$)/.test(body), `invalid Japanese separator: ${body}`);
      assertValid((body.match(/」/g) ?? []).length <= 1, `too many paragraph marks: ${body}`);
      assertValid(!/(^0|[^0-9]0)/.test(body), `number with leading zero: ${body}`);
      validateJaBrackets(body);
      assertValid(Math.ceil(compactLen(body) / PAGE) === telegram.pages, "wabun page count");
      const parts = body.split(/[、」]/);
      assertValid(new Set(parts).size === parts.length, "repeated phrase in Japanese body");
    }
  }

  const share = (pattern) => wabunBodies.filter((body) => pattern.test(body)).length / wabunBodies.length;
  const bracketShare = share(/（/);
  assertValid(bracketShare >= JA_MIN_BRACKET_SHARE, `too few bracketed Japanese bodies ${bracketShare.toFixed(2)}`);
  for (const [label, pattern, rate] of [
    ["numeric", /[0-9]/, JA_NUMERIC_RATE],
    ["paragraph", /」/, JA_PARAGRAPH_RATE],
  ]) {
    const actual = share(pattern);
    assertValid(Math.abs(actual - rate) <= rate / 2, `${label} Japanese bodies ${actual.toFixed(3)} (target ${rate})`);
  }
  const topOpeningShare = Math.max(...jaOpeningCounts(wabunBodies).values()) / wabunBodies.length;
  assertValid(topOpeningShare <= JA_MAX_OPENING_SHARE, `one Japanese opening is overused ${topOpeningShare.toFixed(3)}`);
};

validateGeneratedData();

const path = join(outDir, "sets.json");
// 1ファイルに全科目。手編集より再生成前提なのでコンパクト出力
writeFileSync(
  path,
  `${JSON.stringify({ version: SETS_VERSION, count: COUNT, plain, codes, wabun })}\n`,
);
console.log(`wrote ${path}`);
console.log(
  `  plain=${plain.length} codes=${codes.length} wabun=${wabun.length}`,
);

const sample = plain[0].telegrams[0].body;
console.log("sample plain words:", wordCount(sample), sample.slice(0, 80));
console.log(
  "sample wabun pages:",
  wabun[0].telegrams.map((t) => t.pages),
  "chars",
  wabun[0].telegrams.map((t) => compactLen(t.body)),
);
const plainWordCounts = plain.flatMap((set) => set.telegrams.map((telegram) => wordCount(telegram.body)));
const wabunCharCounts = wabun.flatMap((set) => set.telegrams.map((telegram) => compactLen(telegram.body)));
const plainDurations = plain.map((set) => plainSetDurationSec(set.telegrams));
console.log(
  `  unique bodies plain=${new Set(plain.flatMap((set) => set.telegrams.map((telegram) => telegram.body))).size}/${plainWordCounts.length}`,
  `wabun=${new Set(wabun.flatMap((set) => set.telegrams.map((telegram) => telegram.body))).size}/${wabunCharCounts.length}`,
);
console.log(
  `  ranges plain=${Math.min(...plainWordCounts)}-${Math.max(...plainWordCounts)} words`,
  `wabun=${Math.min(...wabunCharCounts)}-${Math.max(...wabunCharCounts)} chars`,
  `plain-max=${Math.max(...plainDurations).toFixed(1)} sec`,
);
const wabunBodies = wabun.flatMap((set) => set.telegrams.map((telegram) => telegram.body));
const wabunOpenings = jaOpeningCounts(wabunBodies);
console.log(
  `  wabun topics=${JA_SCENARIOS.length} uses=${Math.min(...jaScenarioUseCounts)}-${Math.max(...jaScenarioUseCounts)}`,
  `openings=${wabunOpenings.size} top=${Math.max(...wabunOpenings.values())}`,
  `bracketed=${wabunBodies.filter((body) => body.includes("（")).length}`,
  `numeric=${wabunBodies.filter((body) => /[0-9]/.test(body)).length}`,
  `paragraph=${wabunBodies.filter((body) => body.includes("」")).length}`,
  `/${wabunBodies.length}`,
);

writeExamShards({ version: SETS_VERSION, plain, codes, wabun });
