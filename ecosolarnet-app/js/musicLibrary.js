// Kevin MacLeod (incompetech.com) tracks, licensed under Creative Commons:
// By Attribution 4.0 (http://creativecommons.org/licenses/by/4.0/). Free for
// commercial use — the only requirement is the credit line in `credit()`.
export const MUSIC_LIBRARY = [
  { id: "cheery-monday", title: "Cheery Monday", file: "cheery-monday.m4a" },
  { id: "carefree", title: "Carefree", file: "carefree.m4a" },
  { id: "life-of-riley", title: "Life of Riley", file: "life-of-riley.m4a" },
  { id: "monkeys-spinning-monkeys", title: "Monkeys Spinning Monkeys", file: "monkeys-spinning-monkeys.m4a" },
  { id: "fluffing-a-duck", title: "Fluffing a Duck", file: "fluffing-a-duck.m4a" },
  { id: "happy-alley", title: "Happy Alley", file: "happy-alley.m4a" },
  { id: "wallpaper", title: "Wallpaper", file: "wallpaper.m4a" },
  { id: "marty-gots-a-plan", title: "Marty Gots a Plan", file: "marty-gots-a-plan.m4a" },
  { id: "beauty-flow", title: "Beauty Flow", file: "beauty-flow.m4a" },
  { id: "pixel-peeker-polka-faster", title: "Pixel Peeker Polka (faster)", file: "pixel-peeker-polka-faster.m4a" },
];

export function creditLine(track) {
  return `"${track.title}" Kevin MacLeod (incompetech.com) — Licensed under Creative Commons: By Attribution 4.0 License (http://creativecommons.org/licenses/by/4.0/)`;
}
