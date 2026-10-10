/** Stable IDs only: profile data never supplies an image URL. */
export const AVATARS = [
  {
    "id": "miori-wink",
    "label": "みおり・ウインク",
    "src": "/assets/avatar/miori-wink.webp"
  },
  {
    "id": "miori-radio",
    "label": "みおり・通信",
    "src": "/assets/avatar/miori-radio.webp"
  },
  {
    "id": "miori-heart",
    "label": "みおり・ハート",
    "src": "/assets/avatar/miori-heart.webp"
  },
  {
    "id": "miori-peace",
    "label": "みおり・ピース",
    "src": "/assets/avatar/miori-peace.webp"
  },
  {
    "id": "miori-air",
    "label": "みおり・航空",
    "src": "/assets/avatar/miori-air.webp"
  },
  {
    "id": "miori-sea",
    "label": "みおり・海洋",
    "src": "/assets/avatar/miori-sea.webp"
  },
  {
    "id": "miori-friend",
    "label": "みおりと仲間",
    "src": "/assets/avatar/miori-friend.webp"
  },
  {
    "id": "cat-wave",
    "label": "三毛猫・ごあいさつ",
    "src": "/assets/avatar/cat-wave.webp"
  },
  {
    "id": "cat-sleep",
    "label": "三毛猫・おやすみ",
    "src": "/assets/avatar/cat-sleep.webp"
  },
  {
    "id": "dog",
    "label": "しば犬",
    "src": "/assets/avatar/dog.webp"
  },
  {
    "id": "penguin",
    "label": "ペンギン",
    "src": "/assets/avatar/penguin.webp"
  },
  {
    "id": "seagull",
    "label": "カモメ",
    "src": "/assets/avatar/seagull.webp"
  },
  {
    "id": "dolphin",
    "label": "イルカ",
    "src": "/assets/avatar/dolphin.webp"
  },
  {
    "id": "turtle",
    "label": "カメ",
    "src": "/assets/avatar/turtle.webp"
  },
  {
    "id": "robot-white",
    "label": "白いロボット",
    "src": "/assets/avatar/robot-white.webp"
  },
  {
    "id": "robot-cat",
    "label": "猫ロボット",
    "src": "/assets/avatar/robot-cat.webp"
  },
  {
    "id": "robot-yellow",
    "label": "黄色いロボット",
    "src": "/assets/avatar/robot-yellow.webp"
  },
  {
    "id": "robot-drone",
    "label": "ドローン",
    "src": "/assets/avatar/robot-drone.webp"
  },
  {
    "id": "radio",
    "label": "無線機",
    "src": "/assets/avatar/radio.webp"
  },
  {
    "id": "globe-graduate",
    "label": "地球の卒業生",
    "src": "/assets/avatar/globe-graduate.webp"
  },
  {
    "id": "academy",
    "label": "アカデミー",
    "src": "/assets/avatar/academy.webp"
  },
  {
    "id": "tower",
    "label": "電波塔",
    "src": "/assets/avatar/tower.webp"
  },
  {
    "id": "airplane",
    "label": "飛行機",
    "src": "/assets/avatar/airplane.webp"
  },
  {
    "id": "anchor",
    "label": "いかり",
    "src": "/assets/avatar/anchor.webp"
  },
  {
    "id": "sakura",
    "label": "桜",
    "src": "/assets/avatar/sakura.webp"
  },
  {
    "id": "headphones",
    "label": "ヘッドホン",
    "src": "/assets/avatar/headphones.webp"
  },
  {
    "id": "morse",
    "label": "モールス",
    "src": "/assets/avatar/morse.webp"
  },
  {
    "id": "globe",
    "label": "地球",
    "src": "/assets/avatar/globe.webp"
  },
  {
    "id": "book",
    "label": "本",
    "src": "/assets/avatar/book.webp"
  },
  {
    "id": "star",
    "label": "星",
    "src": "/assets/avatar/star.webp"
  },
  {
    "id": "paw-yellow",
    "label": "黄色の肉球",
    "src": "/assets/avatar/paw-yellow.webp"
  },
  {
    "id": "paw-orange",
    "label": "オレンジの肉球",
    "src": "/assets/avatar/paw-orange.webp"
  }
] as const;

export function getAvatar(id: string | null | undefined) {
  return AVATARS.find((avatar) => avatar.id === id) ?? null;
}
