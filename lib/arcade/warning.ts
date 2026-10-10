/** Presentation uses the paused game clock, never wall time or CSS timers. */
export function warningFrame(elapsed:number,reduced=false){
  const t=Math.max(0,elapsed),title='WARNING',subtitle='BOSS APPROACHING';
  const titleCount=reduced?title.length:Math.min(title.length,Math.floor(t/.065));
  const subCount=reduced?subtitle.length:Math.min(subtitle.length,Math.max(0,Math.floor((t-.85)/.055)));
  const complete=titleCount===title.length;
  return {title:title.slice(0,titleCount),subtitle:subtitle.slice(0,subCount),
    titleCursor:!reduced&&!complete&&Math.floor(t*10)%2===0,
    subCursor:!reduced&&t>=.85&&subCount<subtitle.length&&Math.floor(t*10)%2===0,
    pulse:reduced?1:complete?1+.06*Math.max(0,1-(t-.455)/.35):1,
    glow:complete,bandOffset:reduced?0:(t*65)%160};
}
